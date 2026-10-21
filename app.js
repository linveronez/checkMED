const KEY = 'checkmed.v01';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
let selectedHistoryDate = todayKey();
let historyMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = todayKey();
let agendaMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedEntryDate = todayKey();
let draftMood = '';
let deferredInstallPrompt = null;
let scheduleDraft = [];
let editingMedId = null;
let stockMedId = null;
let welcomeBackSummary = sessionStorage.getItem('checkmed.welcomeBack') || '';
const moodFaces = {
  'muito-bem': '😊',
  bem: '🙂',
  neutro: '😐',
  mal: '🙁',
  'muito-mal': '😣'
};
let corruptBackupKey = '';
let corruptStateFound = false;
const DEFAULT_STATE = {
  schemaVersion: 2,
  meds: [],
  events: [],
  logs: [],
  dailyEntries: {},
  name: '',
  contact: '',
  pharmacyName: '',
  pharmacyPhone: '',
  notificationsEnabled: false,
  hideMedicationNameInNotification: true,
  notificationSent: [],
  lastBackupAt: '',
  onboardingComplete: false,
  dataConsentAt: ''
};
const state = load();

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return {
    ...DEFAULT_STATE
  };
  try {
    return CheckMedCore.migrateState(JSON.parse(raw), DEFAULT_STATE);
  } catch (error) {
    corruptStateFound = true;
    corruptBackupKey = `checkmed.corrupt.${new Date().toISOString().replace(/[:.]/g,'-')}`;
    try {
      localStorage.setItem(corruptBackupKey, raw);
    } catch {}
    return {
      ...DEFAULT_STATE
    };
  }
}

function save() {
  state.schemaVersion = 2;
  localStorage.setItem(KEY, JSON.stringify(state));
}
const PIN_SALT_KEY = 'checkmed.pin.salt',
  PIN_HASH_KEY = 'checkmed.pin.hash',
  PIN_FAILURE_KEY = 'checkmed.pin.failures',
  PIN_LOCK_UNTIL_KEY = 'checkmed.pin.lockUntil';
let lockWhenReturning = false;

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function hashPin(pin, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations: 210000,
    hash: 'SHA-256'
  }, material, 256);
  return bytesToBase64(bits);
}
async function verifyPin(pin) {
  const salt = localStorage.getItem(PIN_SALT_KEY),
    expected = localStorage.getItem(PIN_HASH_KEY);
  if (!salt || !expected || !crypto.subtle) return false;
  return (await hashPin(pin, base64ToBytes(salt))) === expected;
}

function pinRemainingMs() {
  return Math.max(0, Number(localStorage.getItem(PIN_LOCK_UNTIL_KEY) || 0) - Date.now());
}

function clearPinFailures() {
  localStorage.removeItem(PIN_FAILURE_KEY);
  localStorage.removeItem(PIN_LOCK_UNTIL_KEY);
}

function registerPinFailure() {
  const failures = Number(localStorage.getItem(PIN_FAILURE_KEY) || 0) + 1;
  localStorage.setItem(PIN_FAILURE_KEY, String(failures));
  if (failures < 5) return 0;
  const seconds = Math.min(900, 30 * 2 ** (failures - 5));
  localStorage.setItem(PIN_LOCK_UNTIL_KEY, String(Date.now() + seconds * 1000));
  return seconds * 1000;
}
async function checkProtectedPin(pin) {
  if (pinRemainingMs() > 0) return {
    valid: false,
    remaining: pinRemainingMs()
  };
  if (await verifyPin(pin)) {
    clearPinFailures();
    return {
      valid: true,
      remaining: 0
    };
  }
  return {
    valid: false,
    remaining: registerPinFailure()
  };
}

function updatePinLockStatus() {
  const seconds = Math.ceil(pinRemainingMs() / 1000),
    status = $('#pinLockStatus'),
    removeStatus = $('#pinRemoveStatus'),
    button = $('#unlockButton'),
    removeSubmit = $('#pinRemoveForm button[type="submit"]');
  if (button) button.disabled = seconds > 0;
  if (removeSubmit) removeSubmit.disabled = seconds > 0;
  if (status) status.textContent = seconds > 0 ? `Muitas tentativas. Tente novamente em ${seconds} s.` : '';
  if (removeStatus) removeStatus.textContent = seconds > 0 ? `Muitas tentativas. Tente novamente em ${seconds} s.` : '';
}

function openLockDialog() {
  openDialog('lockDialog');
  updatePinLockStatus();
}

function renderPinControls() {
  const configured = Boolean(localStorage.getItem(PIN_HASH_KEY)),
    button = $('#pinSetupButton'),
    remove = $('#pinRemoveButton'),
    privacy = $('#hideNotificationName');
  if (button) button.textContent = configured ? 'Alterar PIN' : 'Criar PIN';
  if (remove) remove.hidden = !configured;
  if (privacy) privacy.checked = Boolean(state.hideMedicationNameInNotification);
}

function startAppGate() {
  if (!state.onboardingComplete) {
    openDialog('onboardingDialog');
    return;
  }
  if (localStorage.getItem(PIN_HASH_KEY)) openLockDialog();
}

function escapeHtml(v = '') {
  return String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
}

function fmtDate(value, opts = {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
}) {
  return new Intl.DateTimeFormat('pt-BR', opts).format(new Date(`${value}T12:00:00`));
}

function recordedTime(log) {
  return log.at ? new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(log.at)) : log.time;
}
let toastTimer;

function showToast(text, action = null) {
  const t = $('#toast'),
    button = $('#toastAction');
  $('#toastMessage').textContent = text;
  button.hidden = !action;
  button.textContent = action?.label || '';
  button.onclick = action ? () => {
    action.onClick();
    button.hidden = true;
    t.classList.remove('show');
  } : null;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

function nav(to) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === to));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.go === to));
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
  if (to === 'profile') $('#profileName').value = state.name;
  render();
  if (to === 'profile') renderNotificationSettings();
}

function scheduleOf(m) {
  return Array.isArray(m.schedule) && m.schedule.length ? m.schedule : (m.times || []).map(time => ({
    time,
    amount: Number(m.perDose) || 1
  }));
}

function formatAmount(value) {
  return CheckMedCore.formatAmount(value);
}

function dosesForDate(day) {
  return state.meds.filter(m => m.mode !== 'asneeded').flatMap(m => scheduleOf(m).map(item => ({
    med: m,
    time: item.time,
    amount: Number(item.amount) || Number(m.perDose) || 1,
    id: `${day}:${m.id}:${item.time}`
  }))).sort((a, b) => a.time.localeCompare(b.time));
}

function dosesForToday() {
  return dosesForDate(todayKey());
}

function stockDays(m) {
  return CheckMedCore.calculateStockDays(m.stock, scheduleOf(m));
}

function stockEndDate(m) {
  const date = new Date(`${todayKey()}T12:00:00`);
  date.setDate(date.getDate() + stockDays(m));
  return `${String(date.getFullYear())}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function addDays(day, count) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + count);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function timePeriod(time) {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'Manhã' : hour < 18 ? 'Tarde' : 'Noite';
}

function timeState(time) {
  const current = new Date(),
    minutes = current.getHours() * 60 + current.getMinutes(),
    scheduled = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return CheckMedCore.isDoseLate(minutes - scheduled) ? 'overdue' : 'upcoming';
}

function doseAdherenceClass(day) {
  const expected = dosesForDate(day),
    ratio = CheckMedCore.adherenceRatio(expected.map(dose => dose.id), state.logs.filter(log => log.date === day));
  if (ratio === null) return '';
  return ratio === 1 ? 'adherence-complete' : 'adherence-partial';
}

function render() {
  const date = new Date();
  $('#todayDate').textContent = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date).toLocaleUpperCase('pt-BR');
  $('#welcomeName').hidden = !state.name;
  $('#welcomeName').textContent = state.name ? `${date.getHours()<12?'Bom dia':date.getHours()<18?'Boa tarde':'Boa noite'}, ${state.name}` : '';
  $('#welcomeBackCard').hidden = !welcomeBackSummary;
  if (welcomeBackSummary) $('#welcomeBackSummary').textContent = welcomeBackSummary;
  const todaysEntry = state.dailyEntries[todayKey()] || {};
  $('#moodShortcutFace').textContent = moodFaces[todaysEntry.mood] || '🙂';
  $('#moodShortcutTitle').textContent = todaysEntry.mood ? 'Seu registro de hoje está salvo' : 'Como você está hoje?';
  $('#moodShortcutSummary').textContent = todaysEntry.mood || todaysEntry.note || todaysEntry.questions ? 'Toque para rever ou atualizar em “Meu dia”.' : 'Seu registro de humor continua em “Meu dia”.';
  const ds = dosesForToday(),
    done = ds.filter(d => state.logs.some(l => l.id === d.id && ['taken', 'taken_late'].includes(l.status))).length,
    percent = ds.length ? Math.round(done / ds.length * 100) : 0;
  $('#progressNumber').textContent = `${done}/${ds.length}`;
  $('#progressRing').style.setProperty('--progress', `${percent}%`);
  $('#todayProgress').textContent = ds.length ? (done === ds.length ? 'Rotina de hoje concluída' : 'Seu ritmo, sem pressa') : 'Tudo no seu tempo';
  $('#todaySummary').textContent = ds.length ? `${done} de ${ds.length} doses registradas hoje.` : 'Cadastre uma medicação para começar.';
  const scheduledCards = CheckMedCore.groupDoses(ds).map(([time, doses]) => {
    const pending = doses.filter(d => !state.logs.some(l => l.id === d.id && ['taken', 'taken_late', 'skipped'].includes(l.status))),
      rows = doses.map(d => {
        const log = state.logs.find(l => l.id === d.id && ['taken', 'taken_late', 'skipped'].includes(l.status)),
          late = timeState(time) === 'overdue',
          statusText = log?.status === 'skipped' ? 'Pulada' : log ? `Tomada às ${escapeHtml(recordedTime(log))}` : '';
        return `<div class="dose-row"><div class="dose-copy"><strong>${escapeHtml(d.med.name)}</strong><span>${escapeHtml(formatAmount(d.amount))} ${d.amount===1?'comprimido':'comprimidos'}${d.med.strength?` · ${escapeHtml(d.med.strength)}`:''}${statusText?` · ${statusText}`:''}</span></div>${log?`<button class="small-action" data-undo-dose="${escapeHtml(d.id)}">Desfazer</button>`:`<div class="dose-actions"><button class="check-button" data-dose="${escapeHtml(d.id)}" data-dose-status="${late?'taken_late':'taken'}">${late?'Registrar agora':'Marcar tomada'}</button><button class="small-action" data-skip-dose="${escapeHtml(d.id)}">Pular</button></div>`}</div>`
      }).join('');
    return `<article class="dose-group ${pending.length?timeState(time):''}"><header><div><span class="dose-group-time">${escapeHtml(time)}</span><span class="dose-group-label">${timePeriod(time)}</span></div>${pending.length>1?`<button class="check-button" data-dose-group="${escapeHtml(time)}">Tomei tudo</button>`:''}</header>${rows}</article>`
  });
  const occasionalLogs = state.logs.filter(l => l.asNeeded && l.status === 'taken' && l.date === todayKey()).sort((a, b) => a.at.localeCompare(b.at)).map(l => `<article class="dose-card"><div class="dose-time">${escapeHtml(recordedTime(l))}</div><div class="dose-copy"><strong>${escapeHtml(l.medName)}</strong><span>Uso eventual · Registrado em ${escapeHtml(fmtDate(l.date,{day:'numeric',month:'short',year:'numeric'}))} às ${escapeHtml(recordedTime(l))}</span></div><span class="check-button done">✓ Registrada</span></article>`);
  const todayCards = [...scheduledCards, ...occasionalLogs];
  $('#todayDoses').innerHTML = todayCards.length ? todayCards.join('') : `<div class="empty-card"><span class="empty-emoji">🌿</span>Quando quiser, cadastre uma medicação para organizar seus horários.</div>`;
  const nextPending = ds.find(d => !state.logs.some(l => l.id === d.id && ['taken', 'taken_late', 'skipped'].includes(l.status)));
  $('#nextDose').hidden = !nextPending;
  $('#nextDose').innerHTML = nextPending ? `${timeState(nextPending.time)==="overdue"?"Dose pendente":"Próxima dose"} · <strong>${escapeHtml(nextPending.time)} — ${escapeHtml(nextPending.med.name)}</strong>` : '';
  const lowStock = state.meds.filter(m => m.mode !== 'asneeded' && stockDays(m) <= 7),
    expiryAlerts = state.meds.filter(m => m.prescriptionExpiry && m.prescriptionExpiry <= addDays(todayKey(), 30));
  $('#stockAlerts').innerHTML = [...lowStock.map(m => `<article class="stock-alert"><span><strong>${escapeHtml(m.name)}</strong> acaba em ${stockDays(m)} ${stockDays(m)===1?'dia':'dias'} · ${escapeHtml(fmtDate(stockEndDate(m),{day:'numeric',month:'short'}))}</span><button class="text-button" data-renew-med="${escapeHtml(m.id)}">Agendar renovação</button></article>`), ...expiryAlerts.map(m => `<article class="stock-alert"><span><strong>${escapeHtml(m.name)}</strong> · ${m.prescriptionExpiry<todayKey()?'receita vencida':'receita vence'} em ${escapeHtml(fmtDate(m.prescriptionExpiry,{day:'numeric',month:'short',year:'numeric'}))}</span><button class="text-button" data-renew-med="${escapeHtml(m.id)}">Agendar renovação</button></article>`)].join('');
  const upcoming = state.events.filter(e => e.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 2);
  $('#upcomingHome').innerHTML = upcoming.length ? upcoming.map(eventMarkup).join('') : `<div class="empty-card">Nenhum compromisso próximo. Sua agenda fica aqui quando precisar.</div>`;
  const dailyMeds = state.meds.filter(m => m.mode !== 'asneeded'),
    asNeeded = state.meds.filter(m => m.mode === 'asneeded');
  const medCard = m => {
    const occasional = m.mode === 'asneeded',
      days = occasional ? null : stockDays(m),
      pct = days === null ? 0 : Math.max(0, Math.min(100, days / 30 * 100)),
      low = days !== null && days <= 7,
      amountLabel = `${formatAmount(m.perDose)} ${m.perDose===1?'comprimido':'comprimidos'}`,
      scheduleLabel = scheduleOf(m).map(item => `${item.time} · ${formatAmount(item.amount)} ${Number(item.amount)===1?'comp.':'comps.'}`).join(' · ');
    return `<article class="med-card"><div class="med-icon">${occasional?'＋':'✳'}</div><div class="med-copy"><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.strength||'')}${occasional?' · Uso eventual':` · ${escapeHtml(scheduleLabel)}`}</span>${occasional?'':`<div class="stock-track"><span style="width:${pct}%;background:${low?'var(--gold)':'var(--green)'}"></span></div>`}<div class="stock-caption">${escapeHtml(formatAmount(m.stock))} ${Number(m.stock)===1?'comprimido':'comprimidos'} em estoque${occasional?` · ${amountLabel} por tomada`:` · acaba em ${escapeHtml(fmtDate(stockEndDate(m),{day:'numeric',month:'short'}))}${low?' · estoque baixo':''}`}${m.prescriptionExpiry?` · receita vence ${escapeHtml(fmtDate(m.prescriptionExpiry,{day:'numeric',month:'short'}))}`:''}</div>${occasional?`<button class="check-button prn-log" data-log-prn="${escapeHtml(m.id)}">Registrar ${amountLabel} tomada</button>`:''}<div class="card-actions"><button class="small-action" data-set-stock="${escapeHtml(m.id)}">Contei e tenho…</button><button class="small-action" data-edit-med="${escapeHtml(m.id)}">Editar</button><button class="small-action" data-delete-med="${escapeHtml(m.id)}">Remover</button></div></div></article>`
  };
  $('#medList').innerHTML = state.meds.length ? `${dailyMeds.length?`<span class="eyebrow list-label">ROTINA DIÁRIA</span>${dailyMeds.map(medCard).join('')}`:''}${asNeeded.length?`<span class="eyebrow list-label">USO EVENTUAL</span>${asNeeded.map(medCard).join('')}`:''}` : `<div class="empty-card"><span class="empty-emoji">💊</span>Seus medicamentos cadastrados vão aparecer aqui.</div>`;
  const dayEvents = state.events.filter(e => e.date === selectedCalendarDate).sort((a, b) => a.time.localeCompare(b.time));
  $('#eventList').innerHTML = dayEvents.length ? dayEvents.map(eventMarkup).join('') : `<div class="empty-card">Nenhum compromisso neste dia.</div>`;
  const nextEvents = state.events.filter(e => e.date >= todayKey() && e.date <= addDays(todayKey(), 30)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  $('#upcomingEvents').innerHTML = nextEvents.length ? nextEvents.map(eventMarkup).join('') : `<div class="empty-card">Nenhum compromisso nos próximos 30 dias.</div>`;
  renderCalendar();
  renderHistory();
  renderCheckin();
  renderNotificationSettings();
  renderPinControls();
  updateBackupStatus();
}

function updateBackupStatus() {
  const el = $('#backupStatus');
  if (!el) return;
  if (!state.lastBackupAt) {
    el.textContent = 'Você ainda não exportou um backup. Guarde uma cópia dos seus dados.';
    return;
  }
  const days = Math.floor((Date.now() - new Date(state.lastBackupAt).getTime()) / 86400000);
  el.textContent = days >= 30 ? `Faz ${days} dias desde o último backup. Exporte uma cópia para guardar seus registros.` : `Último backup: ${fmtDate(state.lastBackupAt.slice(0,10),{day:'numeric',month:'long',year:'numeric'})}.`;
}

function renderNotificationSettings() {
  const button = $('#notificationsButton'),
    status = $('#notificationStatus');
  if (!button || !status) return;
  if (!('Notification' in window)) {
    button.disabled = true;
    button.textContent = 'Indisponível neste navegador';
    status.textContent = 'Este navegador não oferece notificações para o CheckMed.';
    return;
  }
  if (!window.isSecureContext) {
    button.disabled = true;
    button.textContent = 'Abra o app em conexão segura';
    status.textContent = 'Notificações precisam de HTTPS ou de uma instalação local segura. Este endereço de arquivo não permite ativá-las.';
    return;
  }
  button.disabled = Notification.permission === 'denied';
  if (Notification.permission === 'denied') {
    button.textContent = 'Permissão bloqueada';
    status.textContent = 'A permissão foi bloqueada no navegador. Altere-a nas configurações do site para ativar os lembretes.';
  } else if (state.notificationsEnabled && Notification.permission === 'granted') {
    button.textContent = 'Desativar lembretes';
    status.textContent = 'Lembretes ativos para os horários das medicações de rotina.';
  } else {
    button.textContent = 'Ativar lembretes';
    status.textContent = Notification.permission === 'granted' ? 'Permissão concedida. Toque para ativar os lembretes.' : 'Receba um aviso nos horários cadastrados para sua rotina diária.';
  }
}
async function toggleNotifications() {
  if (!('Notification' in window) || !window.isSecureContext) {
    renderNotificationSettings();
    return;
  }
  if (state.notificationsEnabled) {
    state.notificationsEnabled = false;
    save();
    renderNotificationSettings();
    showToast('Lembretes desativados.');
    return;
  }
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    state.notificationsEnabled = false;
    save();
    renderNotificationSettings();
    showToast(permission === 'denied' ? 'Permissão de notificação bloqueada.' : 'Ativação cancelada.');
    return;
  }
  state.notificationsEnabled = true;
  save();
  renderNotificationSettings();
  showToast('Lembretes ativados.');
}

function checkDoseReminders() {
  if (!state.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date(),
    date = todayKey(),
    minute = now.getHours() * 60 + now.getMinutes();
  state.notificationSent = state.notificationSent.filter(key => key.startsWith(`${date}:`));
  let changed = false;
  for (const med of state.meds.filter(item => item.mode !== 'asneeded'))
    for (const item of scheduleOf(med)) {
      const time = item.time,
        [hour, min] = time.split(':').map(Number),
        scheduled = hour * 60 + min,
        elapsed = minute - scheduled;
      if (elapsed < 0) continue;
      const stage = CheckMedCore.reminderStage(elapsed);
      if (!stage) continue;
      const key = `${date}:${med.id}:${time}:${stage}`;
      if (state.notificationSent.includes(key)) continue;
      const doseId = `${date}:${med.id}:${time}`;
      if (state.logs.some(log => log.id === doseId && ['taken', 'taken_late', 'skipped'].includes(log.status))) continue;
      const amount = Number(item.amount) || 1;
      const title = state.hideMedicationNameInNotification ? 'Lembrete de medicamento' : `Hora de ${med.name}`;
      const body = state.hideMedicationNameInNotification ? (stage === 'followup' ? 'Segundo lembrete: confira sua rotina.' : 'Está na hora de conferir sua rotina.') : `${formatAmount(amount)} ${amount===1?'comprimido':'comprimidos'} · horário cadastrado ${time}${stage==='followup'?' · segundo lembrete':''}`;
      const options = {
        body,
        icon: './icon-192.png',
        tag: key,
        data: {
          url: './'
        }
      };
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options)).catch(() => new Notification(title, {
        body,
        tag: key
      }));
      else new Notification(title, {
        body,
        tag: key
      });
      state.notificationSent.push(key);
      changed = true;
    }
  if (changed) save();
}
setInterval(checkDoseReminders, 5000);
setInterval(updatePinLockStatus, 1000);

function lockAppOnReturn() {
  if (!state.onboardingComplete || !localStorage.getItem(PIN_HASH_KEY)) return;
  $$('dialog[open]').forEach(dialog => {
    if (dialog.id !== 'lockDialog') dialog.close();
  });
  if (!$('#lockDialog').open) openLockDialog();
}
window.addEventListener('blur', () => {
  if (state.onboardingComplete && localStorage.getItem(PIN_HASH_KEY)) lockWhenReturning = true;
});
window.addEventListener('focus', () => {
  if (lockWhenReturning) {
    lockWhenReturning = false;
    lockAppOnReturn();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.onboardingComplete && localStorage.getItem(PIN_HASH_KEY)) lockWhenReturning = true;
    return;
  }
  checkDoseReminders();
  if (lockWhenReturning) {
    lockWhenReturning = false;
    lockAppOnReturn();
  }
});

function eventMarkup(e) {
  return `<article class="event-card"><div class="event-icon">▦</div><div class="event-copy"><span class="event-date">${escapeHtml(fmtDate(e.date,{weekday:'short',day:'numeric',month:'short'}))}${e.time?` · ${escapeHtml(e.time)}`:''}</span><strong>${escapeHtml(e.title)}</strong><span>${escapeHtml(e.type)}${e.note?` · ${escapeHtml(e.note)}`:''}</span><button class="small-action" data-export-event="${escapeHtml(e.id)}">Adicionar ao calendário</button></div><button class="small-action" data-delete-event="${escapeHtml(e.id)}" aria-label="Remover compromisso">×</button></article>`;
}

function renderCalendar() {
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(agendaMonth);
  $('#agendaMonthLabel').textContent = label;
  const offset = (agendaMonth.getDay() + 6) % 7,
    count = new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() + 1, 0).getDate(),
    eventDays = new Set(state.events.map(ev => ev.date)),
    logDays = new Set(state.logs.map(log => log.date)),
    cells = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(d => `<span class="weekday">${d}</span>`);
  for (let i = 0; i < offset; i++) cells.push('<span class="history-day empty"></span>');
  for (let n = 1; n <= count; n++) {
    const key = `${agendaMonth.getFullYear()}-${String(agendaMonth.getMonth()+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`,
      entry = state.dailyEntries[key],
      has = eventDays.has(key) || logDays.has(key) || Boolean(entry),
      face = entry ? (moodFaces[entry.mood] || '🙂') : '';
    cells.push(`<button class="history-day ${key===selectedCalendarDate?'selected':''} ${has?'has-record':''}" data-agenda-date="${key}" aria-label="${escapeHtml(fmtDate(key,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${eventDays.has(key)?', com compromisso':''}${logDays.has(key)?', com registro de medicamento':''}${entry?', com registro do dia':''}">${n}${has?`<span class="calendar-mark"><i></i>${face?`<em>${face}</em>`:''}</span>`:''}</button>`);
  }
  $('#agendaCalendar').innerHTML = cells.join('');
  $$('[data-agenda-date]').forEach(day => {
    const cls = doseAdherenceClass(day.dataset.agendaDate);
    if (cls) day.classList.add(cls);
  });
  $('#agendaSelectedLabel').textContent = fmtDate(selectedCalendarDate, {
    day: 'numeric',
    month: 'long'
  });
}

function renderHistory() {
  const monthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(historyMonth);
  $('#historyMonthLabel').textContent = monthLabel;
  const firstWeekday = (historyMonth.getDay() + 6) % 7,
    daysInMonth = new Date(historyMonth.getFullYear(), historyMonth.getMonth() + 1, 0).getDate(),
    currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  $('#historyNextMonth').disabled = historyMonth >= currentMonth;
  const weekdays = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const cells = weekdays.map(d => `<span class="weekday">${d}</span>`);
  for (let i = 0; i < firstWeekday; i++) cells.push('<span class="history-day empty"></span>');
  const recordDates = new Set(state.logs.map(l => l.date));
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(historyMonth.getFullYear(), historyMonth.getMonth(), day),
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
      future = key > todayKey(),
      entry = state.dailyEntries[key],
      hasRecord = recordDates.has(key) || Boolean(entry),
      face = entry ? (moodFaces[entry.mood] || '🙂') : '';
    cells.push(`<button class="history-day ${key===selectedHistoryDate?'selected':''} ${hasRecord?'has-record':''}" data-history-date="${key}" ${future?'disabled':''} aria-label="${escapeHtml(fmtDate(key,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${recordDates.has(key)?', com registros de medicamento':''}${entry?', com registro do dia':''}">${day}${hasRecord?`<span class="calendar-mark"><i></i>${face?`<em>${face}</em>`:''}</span>`:''}</button>`);
  }
  $('#historyCalendar').innerHTML = cells.join('');
  $$('[data-history-date]').forEach(day => {
    const cls = doseAdherenceClass(day.dataset.historyDate);
    if (cls) day.classList.add(cls);
  });
  const logs = state.logs.filter(l => l.date === selectedHistoryDate).sort((a, b) => (b.at || '').localeCompare(a.at || '')),
    entry = state.dailyEntries[selectedHistoryDate],
    summary = entry ? 'Registro do dia salvo' : selectedHistoryDate === todayKey() ? 'Hoje também fica guardado aqui.' : 'Toque em outro dia para consultar.';
  $('#historySummary').innerHTML = `<div><span class="eyebrow">${escapeHtml(fmtDate(selectedHistoryDate,{weekday:'long',day:'numeric',month:'long'}))}</span><strong>${logs.length} ${logs.length===1?'registro':'registros'}</strong></div><span>${escapeHtml(summary)}</span>`;
  const entryCard = entry ? `<article class="history-checkin"><div class="history-checkin-face">${moodFaces[entry.mood]||'📝'}</div><div><strong>Registro do dia</strong>${entry.mood?`<span>${escapeHtml(({ 'muito-bem':'Muito bem',bem:'Bem',neutro:'Neutro',mal:'Mal','muito-mal':'Muito mal'})[entry.mood]||'Humor registrado')}</span>`:''}${entry.note?`<p>${escapeHtml(entry.note)}</p>`:''}${entry.questions?`<p><strong>Perguntar na consulta:</strong> ${escapeHtml(entry.questions)}</p>`:''}${entry.updatedAt?`<small>Salvo às ${escapeHtml(new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(entry.updatedAt)))}</small>`:''}</div></article>` : '';
  const doseCards = logs.map(l => `<article class="history-card ${l.status==='skipped'?'skipped-dose':''}"><div class="history-state">${l.status==='skipped'?'–':'✓'}</div><div><strong>${escapeHtml(l.medName)}</strong><span>${l.amount?`${escapeHtml(formatAmount(l.amount))} ${l.amount===1?'comprimido':'comprimidos'} · `:''}${l.asNeeded?'uso eventual':`prevista ${escapeHtml(l.time)}`} · ${l.status==='skipped'?'marcada como pulada':l.status==='taken_late'?'registrada depois':'registrada'} às ${escapeHtml(recordedTime(l))}</span></div></article>`);
  $('#historyList').innerHTML = `${entryCard}${doseCards.length?doseCards.join(''):`<div class="empty-card">Nenhuma dose registrada neste dia.</div>`}`;
}

function renderCheckin() {
  const entry = state.dailyEntries[selectedEntryDate] || {};
  draftMood = entry.mood || '';
  $('#checkinDateLabel').textContent = fmtDate(selectedEntryDate, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  $('#dailyNote').value = entry.note || '';
  $('#dailyQuestions').value = entry.questions || '';
  $$('.mood-choice').forEach(b => b.classList.toggle('selected', b.dataset.mood === draftMood));
  $('#entryNextDay').disabled = selectedEntryDate >= todayKey();
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (d.showModal) d.showModal();
  else d.setAttribute('open', '');
}

function recordDose(dose, status = 'taken') {
  if (!dose) return;
  const amount = Number(dose.amount) || 1;
  if (status !== 'skipped') dose.med.stock = Math.max(0, Number((Number(dose.med.stock) - amount).toFixed(2)));
  const log = {
    id: dose.id,
    medId: dose.med.id,
    medName: dose.med.name,
    time: dose.time,
    date: todayKey(),
    at: new Date().toISOString(),
    status,
    amount
  };
  state.logs = state.logs.filter(item => item.id !== dose.id);
  state.logs.push(log);
  save();
  render();
  showToast(status === 'skipped' ? 'Dose marcada como pulada.' : status === 'taken_late' ? 'Dose registrada com o horário real.' : 'Dose registrada. Um passo de cada vez.', {
    label: 'Desfazer',
    onClick: () => undoDose(dose.id)
  });
}

function recordDoseGroup(time) {
  const candidates = dosesForToday().filter(d => d.time === time),
    ids = CheckMedCore.pendingDoseIds(candidates, state.logs),
    pending = candidates.filter(d => ids.includes(d.id));
  pending.forEach(recordDoseWithoutRender);
  save();
  render();
  showToast('Doses desse horário registradas.', {
    label: 'Desfazer',
    onClick: () => CheckMedCore.undoDoseBatch(ids, id => undoDose(id, false), save, render)
  });
}

function recordDoseWithoutRender(dose) {
  dose.med.stock = Math.max(0, Number((Number(dose.med.stock) - dose.amount).toFixed(2)));
  state.logs.push({
    id: dose.id,
    medId: dose.med.id,
    medName: dose.med.name,
    time: dose.time,
    date: todayKey(),
    at: new Date().toISOString(),
    status: 'taken',
    amount: dose.amount
  });
}

function undoDose(id, refresh = true) {
  const index = state.logs.findIndex(log => log.id === id);
  if (index < 0) return;
  const [log] = state.logs.splice(index, 1), med = state.meds.find(item => item.id === log.medId);
  if (med && log.status !== 'skipped') med.stock = Number((Number(med.stock) + Number(log.amount || 1)).toFixed(2));
  save();
  if (refresh) render();
}

function skipDose(id) {
  const dose = dosesForToday().find(item => item.id === id);
  if (!dose) return;
  recordDose(dose, 'skipped');
}

function logAsNeeded(medId) {
  const med = state.meds.find(m => m.id === medId);
  if (!med) return;
  if (med.stock < med.perDose) {
    showToast('Estoque insuficiente para esse registro.');
    return;
  }
  const now = new Date(),
    time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  med.stock = Number((med.stock - med.perDose).toFixed(2));
  state.logs.push({
    id: `event:${uid()}`,
    medId: med.id,
    medName: med.name,
    time,
    date: todayKey(),
    at: now.toISOString(),
    status: 'taken',
    amount: med.perDose,
    asNeeded: true
  });
  save();
  render();
  showToast('Tomada registrada no histórico.');
}
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) nav(go.dataset.go);
  const doseButton = e.target.closest('[data-dose]');
  if (doseButton) {
    const dose = dosesForToday().find(item => item.id === doseButton.dataset.dose);
    recordDose(dose, doseButton.dataset.doseStatus || 'taken');
  }
  const doseGroup = e.target.closest('[data-dose-group]');
  if (doseGroup) recordDoseGroup(doseGroup.dataset.doseGroup);
  const skip = e.target.closest('[data-skip-dose]');
  if (skip) skipDose(skip.dataset.skipDose);
  const undo = e.target.closest('[data-undo-dose]');
  if (undo) {
    undoDose(undo.dataset.undoDose);
    render();
    showToast('Registro desfeito. Estoque atualizado.');
  }
  const prn = e.target.closest('[data-log-prn]');
  if (prn) logAsNeeded(prn.dataset.logPrn);
  const mapSearch = e.target.closest('[data-map-search]');
  if (mapSearch) {
    const place = $('#sosLocation').value.trim();
    if (!place) {
      showToast('Informe uma cidade ou bairro para pesquisar.');
      $('#sosLocation').focus();
      return;
    }
    const url = `https://www.google.com/maps/search/${encodeURIComponent(`${mapSearch.dataset.mapSearch} perto de ${place}`)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  const close = e.target.closest('[data-close]');
  if (close) document.getElementById(close.dataset.close).close();
  const delMed = e.target.closest('[data-delete-med]');
  if (delMed && confirm('Remover este medicamento da sua lista? Os registros anteriores serão mantidos no histórico.')) {
    state.meds = state.meds.filter(m => m.id !== delMed.dataset.deleteMed);
    save();
    render();
    showToast('Medicamento removido.');
  }
  const editMed = e.target.closest('[data-edit-med]');
  if (editMed) openEditMed(editMed.dataset.editMed);
  const setStock = e.target.closest('[data-set-stock]');
  if (setStock) openStockDialog(setStock.dataset.setStock);
  const renew = e.target.closest('[data-renew-med]');
  if (renew) createRenewalEvent(renew.dataset.renewMed);
  const delEvent = e.target.closest('[data-delete-event]');
  if (delEvent && confirm('Remover este compromisso da agenda?')) {
    state.events = state.events.filter(x => x.id !== delEvent.dataset.deleteEvent);
    save();
    render();
    showToast('Compromisso removido.');
  }
  const exportEvent = e.target.closest('[data-export-event]');
  if (exportEvent) exportEventIcs(exportEvent.dataset.exportEvent);
});

function exportEventIcs(id) {
  const event = state.events.find(item => item.id === id);
  if (!event) return;
  downloadFile("checkmed-compromisso.ics", CheckMedCore.buildCalendarEvent(event), "text/calendar;charset=utf-8");
  showToast("Arquivo de calendário pronto com lembrete para um dia antes.");
}

function openPastDoseDialog() {
  const meds = state.meds.filter(m => m.mode !== 'asneeded');
  if (!meds.length) {
    showToast('Cadastre uma rotina diária antes de registrar uma dose.');
    return;
  }
  const form = $('#pastDoseForm'),
    date = form.elements.date;
  date.max = todayKey();
  date.value = selectedHistoryDate <= todayKey() ? selectedHistoryDate : todayKey();
  $('#pastDoseMed').innerHTML = meds.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  const updateTimes = () => {
    const med = state.meds.find(m => m.id === $('#pastDoseMed').value);
    $('#pastDoseTime').innerHTML = scheduleOf(med || {}).map(item => `<option value="${escapeHtml(item.time)}">${escapeHtml(item.time)} · ${escapeHtml(formatAmount(item.amount))} comprimidos</option>`).join('');
  };
  $('#pastDoseMed').onchange = updateTimes;
  updateTimes();
  openDialog('pastDoseDialog');
}
$('#openPastDose').addEventListener('click', openPastDoseDialog);
$('#pastDoseForm').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.currentTarget,
    date = form.elements.date.value,
    med = state.meds.find(m => m.id === form.elements.medId.value),
    time = form.elements.time.value,
    item = scheduleOf(med || {}).find(x => x.time === time),
    takenAtTime = form.elements.takenAtTime.value;
  if (!med || !item || date > todayKey()) {
    showToast('Confira a data, o medicamento e o horário.');
    return;
  }
  const id = `${date}:${med.id}:${time}`;
  if (state.logs.some(log => log.id === id)) {
    showToast('Esse horário já tem um registro.');
    return;
  }
  const at = takenAtTime ? new Date(`${date}T${takenAtTime}:00`).toISOString() : new Date().toISOString();
  if (form.elements.deductStock.checked) med.stock = Math.max(0, Number((Number(med.stock) - Number(item.amount)).toFixed(2)));
  state.logs.push({
    id,
    medId: med.id,
    medName: med.name,
    date,
    time,
    at,
    status: date === todayKey() ? 'taken' : 'taken_late',
    amount: Number(item.amount)
  });
  selectedHistoryDate = date;
  historyMonth = new Date(`${date}T12:00:00`);
  historyMonth.setDate(1);
  save();
  $('#pastDoseDialog').close();
  render();
  showToast('Dose registrada no dia escolhido.');
});

function exportConsultationSummary() {
  const end = todayKey(),
    start = addDays(end, -29),
    dates = Array.from({
      length: 30
    }, (_, index) => addDays(start, index)),
    expected = dates.flatMap(date => dosesForDate(date).map(dose => dose.id)),
    logs = state.logs.filter(log => log.date >= start && log.date <= end),
    summary = CheckMedCore.adherenceSummary(expected, logs),
    moodLabels = {
      'muito-bem': 'Muito bem',
      bem: 'Bem',
      neutro: 'Neutro',
      mal: 'Mal',
      'muito-mal': 'Muito mal'
    },
    lines = [`Resumo CheckMed — últimos 30 dias (${fmtDate(start,{day:'numeric',month:'short'})} a ${fmtDate(end,{day:'numeric',month:'short',year:'numeric'})})`, `Adesão estimada: ${summary.percent===null?'sem rotina diária cadastrada':`${summary.percent}% (${summary.completed} de ${summary.expected} doses previstas)`}`, `Doses puladas: ${summary.skipped}`, `Nota: percentual estimado com base nas rotinas atualmente cadastradas.`, '', 'Registros de medicamentos:', ...(logs.length ? logs.map(log => `- ${fmtDate(log.date,{day:'numeric',month:'short'})} · ${log.medName}: ${log.status==='skipped'?'pulada':`${log.amount||1} comprimido(s), ${recordedTime(log)}`}`) : ['- Nenhum registro nos últimos 30 dias']), '', 'Anotações e perguntas para consulta:'];
  const entries = Object.entries(state.dailyEntries).filter(([date, entry]) => date >= start && date <= end && (entry.note || entry.questions || entry.mood)).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length)
    for (const [date, entry] of entries) {
      lines.push(`- ${fmtDate(date,{day:'numeric',month:'short'})}${entry.mood?` · Humor: ${moodLabels[entry.mood]||'registrado'}`:''}`);
      if (entry.note) lines.push(`  Anotação: ${entry.note}`);
      if (entry.questions) lines.push(`  Perguntas: ${entry.questions}`);
    } else lines.push('- Nenhuma anotação no período.');
  downloadFile(`checkmed-consulta-30-dias-${end}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  showToast('Resumo dos últimos 30 dias exportado.');
}
$('#exportConsultation').addEventListener('click', exportConsultationSummary);

function renderScheduleChips() {
  const chips = $('#scheduleChips');
  chips.innerHTML = scheduleDraft.map((item, index) => `<span class="schedule-chip">${escapeHtml(item.time)} · ${escapeHtml(formatAmount(item.amount))} ${Number(item.amount)===1?'comprimido':'comprimidos'}<button type="button" data-remove-schedule="${index}" aria-label="Remover horário ${escapeHtml(item.time)}">×</button></span>`).join('');
  $('#medForm').elements.times.value = scheduleDraft.map(item => item.time).join(',');
}

function resetMedicationForm() {
  editingMedId = null;
  scheduleDraft = [];
  $('#medForm').reset();
  $('#medForm').elements.perDose.value = 1;
  $('#medForm').elements.stock.value = 30;
  $('#medMode').value = 'daily';
  $('#timesField').hidden = false;
  $('#amountField').hidden = true;
  $('#doseFields').classList.add('single-field');
  $('#medDialog').querySelector('.eyebrow').textContent = 'NOVA ROTINA';
  $('#medDialog').querySelector('h2').textContent = 'Medicamento';
  renderScheduleChips();
}
$('#addMedButton').addEventListener('click', () => {
  resetMedicationForm();
  openDialog('medDialog');
});
$('#addScheduleTime').addEventListener('click', () => {
  const time = $('#scheduleTimeInput').value,
    amount = Number($('#scheduleAmountInput').value);
  if (!time) {
    showToast('Escolha um horário antes de adicionar.');
    return;
  }
  if (!(amount > 0)) {
    showToast('Informe quantos comprimidos entram nessa dose.');
    return;
  }
  if (scheduleDraft.some(item => item.time === time)) {
    showToast('Esse horário já está na lista.');
    return;
  }
  scheduleDraft.push({
    time,
    amount
  });
  scheduleDraft.sort((a, b) => a.time.localeCompare(b.time));
  $('#scheduleTimeInput').value = '';
  renderScheduleChips();
});
$('#scheduleChips').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-schedule]');
  if (button) {
    scheduleDraft.splice(Number(button.dataset.removeSchedule), 1);
    renderScheduleChips();
  }
});
$('#historyCalendar').addEventListener('click', e => {
  const day = e.target.closest('[data-history-date]');
  if (day && !day.disabled) {
    selectedHistoryDate = day.dataset.historyDate;
    renderHistory();
  }
});

function moveHistoryMonth(delta) {
  const oldDay = Number(selectedHistoryDate.slice(-2)),
    next = new Date(historyMonth.getFullYear(), historyMonth.getMonth() + delta, 1),
    lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  if (next > new Date(new Date().getFullYear(), new Date().getMonth(), 1)) return;
  historyMonth = next;
  selectedHistoryDate = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(Math.min(oldDay,lastDay)).padStart(2,'0')}`;
  renderHistory();
}
$('#historyPrevMonth').addEventListener('click', () => moveHistoryMonth(-1));
$('#historyNextMonth').addEventListener('click', () => moveHistoryMonth(1));
$('#agendaCalendar').addEventListener('click', e => {
  const day = e.target.closest('[data-agenda-date]');
  if (day) {
    selectedCalendarDate = day.dataset.agendaDate;
    render();
  }
});

function moveAgendaMonth(delta) {
  const day = Number(selectedCalendarDate.slice(-2)),
    next = new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() + delta, 1),
    last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  agendaMonth = next;
  selectedCalendarDate = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
  render();
}
$('#agendaPrevMonth').addEventListener('click', () => moveAgendaMonth(-1));
$('#agendaNextMonth').addEventListener('click', () => moveAgendaMonth(1));
$$('.mood-choice').forEach(button => button.addEventListener('click', () => {
  draftMood = button.dataset.mood;
  $$('.mood-choice').forEach(b => b.classList.toggle('selected', b === button));
}));
$('#saveCheckin').addEventListener('click', () => {
  const note = $('#dailyNote').value.trim(),
    questions = $('#dailyQuestions').value.trim();
  if (!draftMood && !note && !questions) {
    delete state.dailyEntries[selectedEntryDate];
  } else state.dailyEntries[selectedEntryDate] = {
    mood: draftMood,
    note,
    questions,
    updatedAt: new Date().toISOString()
  };
  save();
  nav('today');
  showToast('Registro do dia salvo.');
});
$('#openDaylog').addEventListener('click', () => nav('daylog'));
$('#moodShortcut').addEventListener('click', () => nav('daylog'));
$('#dismissWelcomeBack').addEventListener('click', () => {
  welcomeBackSummary = '';
  sessionStorage.removeItem('checkmed.welcomeBack');
  $('#welcomeBackCard').hidden = true;
});

function moveEntryDate(delta) {
  const date = new Date(`${selectedEntryDate}T12:00:00`);
  date.setDate(date.getDate() + delta);
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  if (key > todayKey()) return;
  selectedEntryDate = key;
  renderCheckin();
}
$('#entryPrevDay').addEventListener('click', () => moveEntryDate(-1));
$('#entryNextDay').addEventListener('click', () => moveEntryDate(1));
$('#medForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget),
    mode = String(f.get('mode')),
    name = String(f.get('name')).trim(),
    perDose = mode === 'daily' ? Number(scheduleDraft[0]?.amount) || 1 : Number(f.get('perDose')),
    times = scheduleDraft.map(item => item.time),
    existing = editingMedId ? state.meds.find(m => m.id === editingMedId) : null;
  if (mode === 'daily' && !scheduleDraft.length) {
    showToast('Adicione pelo menos um horário e a quantidade de comprimidos da dose.');
    return;
  }
  const data = {
    id: editingMedId || uid(),
    mode,
    name,
    strength: String(f.get('strength')).trim(),
    perDose,
    times: mode === 'daily' ? times : [],
    schedule: mode === 'daily' ? scheduleDraft.map(item => ({
      ...item
    })) : [],
    stock: Number(f.get('stock')),
    prescriptionExpiry: String(f.get('prescriptionExpiry') || '')
  };
  if (existing) Object.assign(existing, data);
  else state.meds.push(data);
  save();
  $('#medDialog').close();
  render();
  showToast(existing ? 'Medicamento atualizado.' : mode === 'daily' ? 'Rotina adicionada.' : 'Medicamento eventual adicionado.');
  resetMedicationForm();
});
$('#medMode').addEventListener('change', e => {
  const occasional = e.target.value === 'asneeded';
  $('#timesField').hidden = occasional;
  $('#amountField').hidden = !occasional;
  $('#doseFields').classList.toggle('single-field', !occasional);
});

function openEditMed(id) {
  const med = state.meds.find(item => item.id === id);
  if (!med) return;
  editingMedId = id;
  const form = $('#medForm');
  form.elements.name.value = med.name;
  form.elements.mode.value = med.mode;
  form.elements.strength.value = med.strength || '';
  form.elements.perDose.value = med.mode === 'asneeded' ? med.perDose || 1 : scheduleOf(med)[0]?.amount || med.perDose || 1;
  form.elements.stock.value = med.stock;
  form.elements.prescriptionExpiry.value = med.prescriptionExpiry || '';
  scheduleDraft = scheduleOf(med).map(item => ({
    ...item
  }));
  $('#timesField').hidden = med.mode === 'asneeded';
  $('#amountField').hidden = med.mode !== 'asneeded';
  $('#doseFields').classList.toggle('single-field', med.mode !== 'asneeded');
  $('#medDialog').querySelector('.eyebrow').textContent = 'EDITAR MEDICAMENTO';
  $('#medDialog').querySelector('h2').textContent = med.name;
  renderScheduleChips();
  openDialog('medDialog');
}

function parseAmount(value) {
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function openStockDialog(id) {
  const med = state.meds.find(item => item.id === id);
  if (!med) return;
  stockMedId = id;
  $('#stockForm').elements.stock.value = String(med.stock).replace('.', ',');
  updateStockForecast();
  openDialog('stockDialog');
}
function updateStockForecast() {
  const med = state.meds.find(item => item.id === stockMedId),
    amount = parseAmount($('#stockForm').elements.stock.value),
    forecast = $('#stockForecast');
  if (!med || med.mode === 'asneeded') {
    forecast.textContent = med ? 'O estoque de uso eventual será atualizado após salvar.' : '';
    return;
  }
  if (amount === null) {
    forecast.textContent = 'Digite a quantidade para estimar por quantos dias o estoque deve durar.';
    return;
  }
  const days = stockDays({ ...med, stock: amount });
  forecast.textContent = `Com essa quantidade, a previsão é de ${days} ${days === 1 ? 'dia' : 'dias'} de estoque, até ${fmtDate(addDays(todayKey(), days), { day: 'numeric', month: 'long' })}.`;
}
$('#stockForm').elements.stock.addEventListener('input', updateStockForecast);
$('#stockForm').addEventListener('submit', e => {
  e.preventDefault();
  const med = state.meds.find(item => item.id === stockMedId),
    amount = parseAmount(e.currentTarget.elements.stock.value);
  if (amount === null) {
    showToast('Digite uma quantidade válida, como 12,5.');
    return;
  }
  if (med) {
    med.stock = amount;
    const days = med.mode === 'asneeded' ? null : stockDays(med);
    $('#stockDialog').close();
    save();
    render();
    showToast(days === null ? 'Estoque atualizado.' : `Estoque atualizado: previsão de ${days} ${days === 1 ? 'dia' : 'dias'}.`);
  }
});

function createRenewalEvent(medId) {
  const med = state.meds.find(item => item.id === medId);
  if (!med) return;
  const date = stockEndDate(med),
    title = `Renovar receita · ${med.name}`;
  if (!state.events.some(event => event.title === title && event.date === date)) state.events.push({
    id: uid(),
    type: 'Renovar receita',
    title,
    date,
    time: '',
    note: 'Agendamento sugerido pela previsão de estoque.'
  });
  selectedCalendarDate = date;
  agendaMonth = new Date(`${date}T12:00:00`);
  agendaMonth.setDate(1);
  save();
  nav('calendar');
  showToast('Lembrete de renovação adicionado à agenda.');
}
$('#addEventButton').addEventListener('click', () => {
  const f = $('#eventForm');
  f.elements.date.value = selectedCalendarDate;
  openDialog('eventDialog');
});
$('#eventForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget),
    date = String(f.get('date'));
  state.events.push({
    id: uid(),
    type: String(f.get('type')),
    title: String(f.get('title')).trim(),
    date,
    time: String(f.get('time')),
    note: String(f.get('note')).trim()
  });
  selectedCalendarDate = date;
  agendaMonth = new Date(`${date}T12:00:00`);
  agendaMonth.setDate(1);
  save();
  e.currentTarget.reset();
  $('#eventDialog').close();
  render();
  showToast('Compromisso adicionado à agenda.');
});
$('#profileButton').addEventListener('click', () => nav('profile'));
$('#notificationsButton').addEventListener('click', toggleNotifications);

function updateInstallButton() {
  const button = $('#installAppButton');
  if (!button) return;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  button.textContent = installed ? 'CheckMed já está instalado' : 'Instalar aplicativo';
  button.disabled = installed;
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  showToast('CheckMed instalado.');
});
$('#installAppButton').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
    updateInstallButton();
    return;
  }
  showToast(/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'No Safari: Compartilhar → Adicionar à Tela de Início.' : 'Use o menu do navegador para instalar o CheckMed.');
});
updateInstallButton();
function trustedContactCard() {
  const contact = String(state.contact || '').trim();
  if (!contact) return '<div class="contact-card"><span class="contact-card-icon">♧</span><div><strong>Contato de confiança</strong><small>Adicione um contato para encontrá-lo rapidamente quando precisar.</small></div></div>';
  const digits = contact.replace(/\D/g, ''),
    phoneOnly = /^\+?[\d\s().-]+$/.test(contact) && [10, 11, 12, 13].includes(digits.length),
    phone = `${contact.trim().startsWith('+') ? '+' : ''}${digits}`;
  return `<div class="contact-card"><span class="contact-card-icon">♧</span><div><strong>Contato de confiança</strong><small>${escapeHtml(contact)}</small>${phoneOnly ? `<a class="trusted-contact-call" href="tel:${phone}">Ligar</a>` : ''}</div></div>`;
}
$('#sosButton').addEventListener('click', () => {
  const meds = state.meds.length ? `<p class="medicine-emergency"><strong>Medicamentos cadastrados:</strong> ${state.meds.map(m=>`${escapeHtml(m.name)} ${escapeHtml(m.strength)}`).join(', ')}</p>` : '';
  $('#sosContent').innerHTML = trustedContactCard() + meds;
  $('#contactForm').elements.contact.value = state.contact;
  $('#pharmacyForm').elements.pharmacyName.value = state.pharmacyName;
  $('#pharmacyForm').elements.pharmacyPhone.value = state.pharmacyPhone;
  const digits = state.pharmacyPhone.replace(/[^\d+]/g, '');
  $('#pharmacySaved').innerHTML = state.pharmacyPhone ? `<a class="saved-phone-link" href="tel:${escapeHtml(digits)}">Ligar para ${escapeHtml(state.pharmacyName||'farmácia salva')} · ${escapeHtml(state.pharmacyPhone)}</a>` : '';
  openDialog('sosDialog');
  $('#closeSosDialog').focus();
});
$('#sosDialog').addEventListener('close', () => $('#sosButton').focus());
$('#pharmacyForm').addEventListener('submit', e => {
  e.preventDefault();
  state.pharmacyName = e.currentTarget.elements.pharmacyName.value.trim();
  state.pharmacyPhone = e.currentTarget.elements.pharmacyPhone.value.trim();
  save();
  const digits = state.pharmacyPhone.replace(/[^\d+]/g, '');
  $('#pharmacySaved').innerHTML = state.pharmacyPhone ? `<a class="saved-phone-link" href="tel:${escapeHtml(digits)}">Ligar para ${escapeHtml(state.pharmacyName||'farmácia salva')} · ${escapeHtml(state.pharmacyPhone)}</a>` : '';
  showToast('Telefone salvo neste aparelho.');
});
$('#contactForm').addEventListener('submit', e => {
  e.preventDefault();
  state.contact = e.currentTarget.elements.contact.value.trim();
  save();
  $('#sosContent').innerHTML = trustedContactCard();
  showToast('Contato salvo neste aparelho.');
});

function downloadFile(name, content, type) {
  const blob = new Blob([content], {
      type
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#exportButton').addEventListener('click', () => {
  state.lastBackupAt = new Date().toISOString();
  save();
  downloadFile(`checkmed-backup-${todayKey()}.json`, JSON.stringify({
    ...state,
    exportedAt: new Date().toISOString()
  }, null, 2), 'application/json');
  updateBackupStatus();
  showToast('Backup exportado. Guarde o arquivo em um local seguro.');
});

function validateBackup(value) {
  return CheckMedCore.validateBackup(value, DEFAULT_STATE);
}
$('#importButton').addEventListener('click', () => $('#importFile').click());
async function importBackupFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = validateBackup(JSON.parse(await file.text()));
    if (!confirm('Importar este backup substituirá os dados atuais do CheckMed. Uma cópia dos dados atuais será guardada neste navegador. Continuar?')) return;
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}.${Math.random().toString(36).slice(2,6)}`;
    CheckMedCore.snapshotState(localStorage, KEY, 'checkmed.preimport', stamp);
    for (const key of Object.keys(DEFAULT_STATE)) state[key] = imported[key];
    state.lastBackupAt = new Date().toISOString();
    save();
    if ($('#recoveryDialog').open) $('#recoveryDialog').close();
    const recordCount = state.logs.length + Object.values(state.dailyEntries).filter(entry => entry.mood || entry.note || entry.questions).length;
    welcomeBackSummary = `Seus dados foram recuperados: ${state.meds.length} ${state.meds.length === 1 ? 'medicamento' : 'medicamentos'}, ${state.events.length} ${state.events.length === 1 ? 'compromisso' : 'compromissos'} e ${recordCount} ${recordCount === 1 ? 'registro' : 'registros'}.`;
    sessionStorage.setItem('checkmed.welcomeBack', welcomeBackSummary);
    nav('today');
    showToast('Backup importado com sucesso.');
  } catch (error) {
    showToast(error.message || 'Não foi possível importar esse arquivo.');
  } finally {
    input.value = '';
  }
}
$('#importFile').addEventListener('change', e => importBackupFile(e.currentTarget));
$('#recoveryImportButton').addEventListener('click', () => $('#recoveryImportFile').click());
$('#recoveryImportFile').addEventListener('change', e => importBackupFile(e.currentTarget));
$('#forgotPinButton').addEventListener('click', () => {
  $('#lockDialog').close();
  openDialog('forgotPinDialog');
});

function returnToPinLock() {
  if ($('#forgotPinDialog').open) $('#forgotPinDialog').close();
  openLockDialog();
}
$('#cancelForgotPin').addEventListener('click', returnToPinLock);
$('#cancelForgotPinButton').addEventListener('click', returnToPinLock);
$('#eraseForRecovery').addEventListener('click', () => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('checkmed.')) localStorage.removeItem(key);
  }
  for (const key of Object.keys(DEFAULT_STATE)) state[key] = Array.isArray(DEFAULT_STATE[key]) ? [] : DEFAULT_STATE[key] && typeof DEFAULT_STATE[key] === 'object' ? {} : DEFAULT_STATE[key];
  state.onboardingComplete = false;
  state.dataConsentAt = '';
  save();
  render();
  $('#forgotPinDialog').close();
  openDialog('recoveryDialog');
});
$('#startWithoutBackup').addEventListener('click', () => {
  $('#recoveryDialog').close();
  openDialog('onboardingDialog');
});

function initStoragePersistence() {
  if (!navigator.storage?.persist || localStorage.getItem('checkmed.persistenceRequested')) return;
  navigator.storage.persist().catch(() => false).finally(() => {
    try {
      localStorage.setItem('checkmed.persistenceRequested', '1');
    } catch {}
  });
}
$('#onboardingForm').addEventListener('submit', e => {
  e.preventDefault();
  state.name = e.currentTarget.elements.name.value.trim();
  state.onboardingComplete = true;
  state.dataConsentAt = new Date().toISOString();
  save();
  $('#onboardingDialog').close();
  render();
  showToast('Boas-vindas ao CheckMed.');
});
$('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  state.name = $('#profileName').value.trim();
  save();
  render();
  showToast('Perfil salvo neste aparelho.');
});
$('#pinSetupButton').addEventListener('click', () => {
  const current = Boolean(localStorage.getItem(PIN_HASH_KEY));
  $('#currentPinField').hidden = !current;
  $('#pinForm').elements.currentPin.required = current;
  $('#pinDialogTitle').textContent = current ? 'Alterar PIN' : 'Criar PIN';
  $('#pinForm').reset();
  openDialog('pinDialog');
});
$('#pinForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!crypto.subtle) {
    showToast('Este navegador não permite criar um PIN local aqui.');
    return;
  }
  const form = e.currentTarget,
    current = form.elements.currentPin.value,
    pin = form.elements.pin.value;
  if (localStorage.getItem(PIN_HASH_KEY)) {
    const result = await checkProtectedPin(current);
    if (!result.valid) {
      updatePinLockStatus();
      showToast(result.remaining ? `PIN incorreto. Aguarde ${Math.ceil(result.remaining/1000)} s.` : 'PIN atual incorreto.');
      form.elements.currentPin.value = '';
      return;
    }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    hash = await hashPin(pin, salt);
  localStorage.setItem(PIN_SALT_KEY, bytesToBase64(salt));
  localStorage.setItem(PIN_HASH_KEY, hash);
  clearPinFailures();
  $('#pinDialog').close();
  renderPinControls();
  showToast('PIN local atualizado.');
});
$('#pinRemoveButton').addEventListener('click', () => {
  if (pinRemainingMs()) {
    openLockDialog();
    return;
  }
  $('#pinRemoveForm').reset();
  openDialog('pinRemoveDialog');
});
$('#pinRemoveForm').addEventListener('submit', async e => {
  e.preventDefault();
  const result = await checkProtectedPin(e.currentTarget.elements.pin.value);
  if (!result.valid) {
    updatePinLockStatus();
    showToast(result.remaining ? `PIN incorreto. Aguarde ${Math.ceil(result.remaining/1000)} s.` : 'PIN incorreto.');
    e.currentTarget.reset();
    return;
  }
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(PIN_HASH_KEY);
  clearPinFailures();
  $('#pinRemoveDialog').close();
  renderPinControls();
  showToast('Trava local desativada.');
});
$('#hideNotificationName').addEventListener('change', e => {
  state.hideMedicationNameInNotification = e.currentTarget.checked;
  save();
  showToast(state.hideMedicationNameInNotification ? 'Nome do medicamento oculto nas notificações.' : 'Nome do medicamento visível nas notificações.');
});
$('#lockNowButton').addEventListener('click', () => {
  if (localStorage.getItem(PIN_HASH_KEY)) openLockDialog();
  else showToast('Crie um PIN antes de bloquear o CheckMed.');
});
$('#unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const result = await checkProtectedPin(e.currentTarget.elements.pin.value);
  if (result.valid) {
    lockWhenReturning = false;
    $('#lockDialog').close();
    e.currentTarget.reset();
    updatePinLockStatus();
  } else {
    updatePinLockStatus();
    showToast(result.remaining ? `Muitas tentativas. Aguarde ${Math.ceil(result.remaining/1000)} s.` : 'PIN incorreto. Tente novamente.');
    e.currentTarget.reset();
    if (!result.remaining) $('#unlockPin').focus();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('dialog[open]').forEach(d => {
    if (['lockDialog', 'onboardingDialog', 'forgotPinDialog', 'recoveryDialog'].includes(d.id)) {
      e.preventDefault();
      return;
    }
    d.close();
  });
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
initStoragePersistence();
if (corruptStateFound) showToast(`Os dados anteriores foram preservados em ${corruptBackupKey}. O app iniciou vazio para evitar sobrescrever o arquivo corrompido.`);
startAppGate();
