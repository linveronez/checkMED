(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CheckMedCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const LOG_STATUSES = ['taken', 'taken_late', 'skipped'];

  function normalizeTime(value) {
    const text = String(value ?? '').trim();
    let match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) match = text.match(/^(\d{1,2})h(\d{0,2})$/i);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2] || 0);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function parseTimeList(value) {
    const parts = String(value ?? '').split(/[;,\n]+/).map(part => part.trim()).filter(Boolean);
    const times = [], invalid = [];
    for (const part of parts) {
      const normalized = normalizeTime(part);
      if (!normalized) invalid.push(part);
      else if (!times.includes(normalized)) times.push(normalized);
    }
    return { times: times.sort(), invalid };
  }

  function calculateStockDays(stock, schedule) {
    const daily = (Array.isArray(schedule) ? schedule : []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return daily > 0 ? Math.floor(Math.max(0, Number(stock) || 0) / daily) : 0;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    const fractions = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
    return fractions[amount] || new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(amount);
  }

  function groupDoses(doses) {
    const groups = new Map();
    for (const dose of Array.isArray(doses) ? doses : []) {
      if (!groups.has(dose.time)) groups.set(dose.time, []);
      groups.get(dose.time).push(dose);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  function pendingDoseIds(doses, logs) {
    const recorded = new Set((Array.isArray(logs) ? logs : [])
      .filter(log => log && ['taken', 'taken_late', 'skipped'].includes(log.status))
      .map(log => log.id));
    return (Array.isArray(doses) ? doses : []).filter(dose => !recorded.has(dose.id)).map(dose => dose.id);
  }

  function undoDoseBatch(ids, undoOne, persist, rerender) {
    for (const id of Array.isArray(ids) ? ids : []) undoOne(id);
    persist();
    rerender();
  }

  function isDoseLate(elapsedMinutes, toleranceMinutes = 60) {
    return Number(elapsedMinutes) > Number(toleranceMinutes);
  }

  function reminderStage(elapsedMinutes) {
    if (Number(elapsedMinutes) < 0) return null;
    return Number(elapsedMinutes) >= 30 ? 'followup' : 'initial';
  }

  function snapshotState(storage, stateKey, snapshotPrefix, identifier) {
    const current = storage.getItem(stateKey);
    if (current === null) return null;
    const snapshotKey = `${snapshotPrefix}.${identifier}`;
    storage.setItem(snapshotKey, current);
    return snapshotKey;
  }

  function adherenceSummary(expectedIds, logs) {
    const ids = [...new Set(Array.isArray(expectedIds) ? expectedIds : [])];
    const relevant = (Array.isArray(logs) ? logs : []).filter(log => log && ids.includes(log.id));
    const completedIds = new Set(relevant.filter(log => ['taken', 'taken_late'].includes(log.status)).map(log => log.id));
    const skippedIds = new Set(relevant.filter(log => log.status === 'skipped').map(log => log.id));
    return {
      expected: ids.length,
      completed: completedIds.size,
      skipped: skippedIds.size,
      percent: ids.length ? Math.round(completedIds.size / ids.length * 100) : null,
    };
  }

  function adherenceRatio(expectedIds, logs) {
    const summary = adherenceSummary(expectedIds, logs);
    if (!summary.expected || summary.completed + summary.skipped === 0) return null;
    return summary.completed / summary.expected;
  }

  function buildCalendarEvent(event, now = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const startDate = new Date(`${event.date}T${event.time || '09:00'}:00`);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const asIcsTime = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
    const escape = value => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CheckMed//Agenda//PT-BR', 'BEGIN:VEVENT',
      `UID:${escape(event.id)}@checkmed`, `DTSTAMP:${stamp}`, `DTSTART:${asIcsTime(startDate)}`, `DTEND:${asIcsTime(endDate)}`,
      `SUMMARY:${escape(event.title)}`, `DESCRIPTION:${escape(`${event.type || ''} ${event.note || ''}`)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${escape(event.title)}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
  }

  function migrateState(value, defaults) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Formato de dados inválido.');
    const migrated = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) migrated[key] = value[key];
    }
    migrated.schemaVersion = 2;
    migrated.onboardingComplete = value.onboardingComplete ?? true;
    migrated.meds = (Array.isArray(value.meds) ? value.meds : []).map(med => {
      if (!med || typeof med !== 'object' || Array.isArray(med)) throw new Error('Medicamento local inválido.');
      const times = Array.isArray(med.times) ? med.times : [];
      const oldAmount = Number(med.perDose) || 1;
      const schedule = Array.isArray(med.schedule) ? med.schedule : times.map(time => ({ time, amount: oldAmount }));
      if (schedule.some(item => !item || !TIME_RE.test(item.time) || !(Number(item.amount) > 0))) throw new Error('Horário local inválido.');
      return {
        id: String(med.id || ''), name: String(med.name || ''), mode: med.mode === 'asneeded' ? 'asneeded' : 'daily',
        strength: String(med.strength || ''), perDose: oldAmount, stock: Math.max(0, Number(med.stock) || 0),
        prescriptionExpiry: String(med.prescriptionExpiry || ''), schedule: schedule.map(item => ({ time: item.time, amount: Number(item.amount) })),
        times: schedule.map(item => item.time),
      };
    });
    migrated.events = (Array.isArray(value.events) ? value.events : []).map(event => {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Compromisso local inválido.');
      return { id: String(event.id || ''), title: String(event.title || ''), type: String(event.type || 'Outro'), date: String(event.date || ''), time: String(event.time || ''), note: String(event.note || '') };
    });
    migrated.logs = (Array.isArray(value.logs) ? value.logs : []).filter(log => log && !log.demo).map(log => {
      if (typeof log !== 'object') throw new Error('Registro local inválido.');
      return { id: String(log.id || ''), medId: String(log.medId || ''), medName: String(log.medName || ''), date: String(log.date || ''), time: String(log.time || ''), at: String(log.at || ''), status: LOG_STATUSES.includes(log.status) ? log.status : 'taken', amount: Number(log.amount) || 1, asNeeded: Boolean(log.asNeeded) };
    });
    migrated.dailyEntries = value.dailyEntries && typeof value.dailyEntries === 'object' && !Array.isArray(value.dailyEntries) ? value.dailyEntries : {};
    migrated.notificationSent = Array.isArray(value.notificationSent) ? value.notificationSent.filter(item => typeof item === 'string') : [];
    migrated.notificationsEnabled = Boolean(value.notificationsEnabled);
    migrated.hideMedicationNameInNotification = value.hideMedicationNameInNotification ?? defaults.hideMedicationNameInNotification ?? true;
    return migrated;
  }

  function validateBackup(value, defaults) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O arquivo precisa conter um objeto JSON.');
    for (const key of ['meds', 'events', 'logs']) {
      if (!Array.isArray(value[key])) throw new Error(`O backup não contém uma lista válida de ${key}.`);
    }
    if (value.dailyEntries !== undefined && (!value.dailyEntries || typeof value.dailyEntries !== 'object' || Array.isArray(value.dailyEntries))) throw new Error('A lista de registros do dia está inválida.');

    const meds = value.meds.map(med => {
      if (!med || typeof med !== 'object' || typeof med.id !== 'string' || typeof med.name !== 'string' || !['daily', 'asneeded'].includes(med.mode) || !Number.isFinite(Number(med.stock)) || Number(med.stock) < 0) throw new Error('Um medicamento do backup está incompleto.');
      const schedule = Array.isArray(med.schedule) ? med.schedule : (Array.isArray(med.times) ? med.times.map(time => ({ time, amount: Number(med.perDose) || 1 })) : []);
      if (schedule.some(item => !item || typeof item !== 'object' || !TIME_RE.test(item.time) || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0)) throw new Error(`Horário ou dose inválida em ${med.name}.`);
      return { id: med.id, name: med.name, mode: med.mode, strength: String(med.strength || ''), perDose: Number(med.perDose) || 1, stock: Number(med.stock), prescriptionExpiry: String(med.prescriptionExpiry || ''), schedule: schedule.map(item => ({ time: item.time, amount: Number(item.amount) })), times: schedule.map(item => item.time) };
    });
    const events = value.events.map(event => {
      if (!event || typeof event.id !== 'string' || typeof event.title !== 'string' || !DATE_RE.test(event.date)) throw new Error('Um compromisso do backup está inválido.');
      return { id: event.id, title: event.title, type: String(event.type || 'Outro'), date: event.date, time: String(event.time || ''), note: String(event.note || '') };
    });
    const logs = value.logs.map(log => {
      if (!log || typeof log.id !== 'string' || typeof log.medName !== 'string' || !DATE_RE.test(log.date) || !LOG_STATUSES.includes(log.status)) throw new Error('Um registro de medicamento do backup está inválido.');
      return { id: log.id, medId: String(log.medId || ''), medName: log.medName, date: log.date, time: String(log.time || ''), at: String(log.at || ''), status: log.status, amount: Number(log.amount) || 1, asNeeded: Boolean(log.asNeeded) };
    });
    const dailyEntries = {};
    for (const [date, entry] of Object.entries(value.dailyEntries || {})) {
      if (!DATE_RE.test(date) || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Um registro diário do backup está inválido.');
      dailyEntries[date] = { mood: String(entry.mood || ''), note: String(entry.note || ''), questions: String(entry.questions || ''), updatedAt: String(entry.updatedAt || '') };
    }
    return {
      ...defaults, schemaVersion: 2, meds, events, logs, dailyEntries,
      name: String(value.name || ''), contact: String(value.contact || ''), pharmacyName: String(value.pharmacyName || ''), pharmacyPhone: String(value.pharmacyPhone || ''),
      notificationsEnabled: false, notificationSent: [], hideMedicationNameInNotification: value.hideMedicationNameInNotification ?? true,
      lastBackupAt: String(value.lastBackupAt || ''), onboardingComplete: true, dataConsentAt: String(value.dataConsentAt || ''),
    };
  }

  return { normalizeTime, parseTimeList, calculateStockDays, formatAmount, groupDoses, pendingDoseIds, undoDoseBatch, isDoseLate, reminderStage, snapshotState, adherenceSummary, adherenceRatio, buildCalendarEvent, migrateState, validateBackup };
});
