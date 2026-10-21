const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const api = require('../api.js');

test('normalizes valid times and rejects invalid times', () => {
  assert.equal(core.normalizeTime('8:00'), '08:00');
  assert.equal(core.normalizeTime('8h'), '08:00');
  assert.equal(core.normalizeTime('25:00'), null);
  assert.equal(core.normalizeTime('8:90'), null);
});

test('parses a list and returns invalid entries instead of dropping them', () => {
  assert.deepEqual(core.parseTimeList('8:00, 20:00; 25:70'), {
    times: ['08:00', '20:00'], invalid: ['25:70'],
  });
});

test('estimates stock using variable doses and formats fractions', () => {
  assert.equal(core.calculateStockDays(30, [{ amount: 1 }, { amount: 2 }]), 10);
  assert.equal(core.calculateStockDays(2, [{ amount: 0.5 }]), 4);
  assert.equal(core.formatAmount(0.5), '½');
  assert.equal(core.formatAmount(1.25), '1,25');
});

test('adherence color follows completed doses over expected doses', () => {
  const expected = ['morning', 'evening'];
  assert.equal(core.adherenceRatio(expected, []), null);
  assert.equal(core.adherenceRatio(expected, [
    { id: 'morning', status: 'taken_late' },
    { id: 'evening', status: 'taken' },
  ]), 1);
  assert.equal(core.adherenceRatio(expected, [
    { id: 'morning', status: 'taken_late' },
    { id: 'evening', status: 'skipped' },
  ]), 0.5);
});

test('groups doses by scheduled time in chronological order', () => {
  assert.deepEqual(core.groupDoses([
    { id: 'late', time: '20:00' },
    { id: 'early-1', time: '08:00' },
    { id: 'early-2', time: '08:00' },
  ]), [
    ['08:00', [{ id: 'early-1', time: '08:00' }, { id: 'early-2', time: '08:00' }]],
    ['20:00', [{ id: 'late', time: '20:00' }]],
  ]);
});

test('group undo only reverses doses recorded by this action and rerenders', () => {
  const pending = core.pendingDoseIds([
    { id: 'already-taken' }, { id: 'new-a' }, { id: 'new-b' },
  ], [{ id: 'already-taken', status: 'taken' }]);
  const calls = [];
  core.undoDoseBatch(pending, id => calls.push(`undo:${id}`), () => calls.push('save'), () => calls.push('render'));
  assert.deepEqual(calls, ['undo:new-a', 'undo:new-b', 'save', 'render']);
});

test('late status waits for the one-hour tolerance and reminders have a follow-up stage', () => {
  assert.equal(core.isDoseLate(60), false);
  assert.equal(core.isDoseLate(61), true);
  assert.equal(core.reminderStage(-1), null);
  assert.equal(core.reminderStage(29), 'initial');
  assert.equal(core.reminderStage(30), 'followup');
});

test('import snapshots the current local state before it is replaced', () => {
  const values = new Map([['checkmed.v01', '{"meds":["current"]}']]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
  const key = core.snapshotState(storage, 'checkmed.v01', 'checkmed.preimport', 'fixed-stamp');
  assert.equal(key, 'checkmed.preimport.fixed-stamp');
  assert.equal(values.get(key), '{"meds":["current"]}');
  values.set('checkmed.v01', '{"meds":["imported"]}');
  assert.equal(values.get(key), '{"meds":["current"]}');
});

test('migrates legacy schedules and removes demo history', () => {
  const defaults = { schemaVersion: 1, meds: [], events: [], logs: [], dailyEntries: {}, notificationSent: [], hideMedicationNameInNotification: true };
  const state = core.migrateState({
    meds: [{ id: 'med-1', name: 'Remédio', mode: 'daily', times: ['08:00', '20:00'], perDose: 2, stock: 12 }],
    logs: [{ id: 'demo', demo: true }, { id: 'real', medName: 'Remédio', status: 'taken', date: '2026-10-19' }],
  }, defaults);

  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.meds[0].schedule, [{ time: '08:00', amount: 2 }, { time: '20:00', amount: 2 }]);
  assert.deepEqual(state.logs.map(log => log.id), ['real']);
});

test('validates and whitelists backup fields', () => {
  const defaults = { schemaVersion: 2, notificationsEnabled: false, hideMedicationNameInNotification: true };
  const backup = core.validateBackup({
    meds: [{ id: 'm1', name: 'Remédio', mode: 'daily', stock: 10, times: ['08:00'], perDose: 1 }],
    events: [], logs: [], unexpected: 'discard me',
  }, defaults);
  assert.equal(backup.meds[0].schedule[0].amount, 1);
  assert.equal(backup.unexpected, undefined);
  assert.throws(() => core.validateBackup({ meds: [], events: [], logs: [{ id: 'x', medName: 'X', date: 'ontem', status: 'taken' }] }, defaults), /registro de medicamento do backup está inválido/);
});

test('exports calendar events with a one-day reminder', () => {
  const ics = core.buildCalendarEvent({ id: 'event-1', date: '2026-10-20', time: '10:30', title: 'Consulta', type: 'Retorno' }, new Date('2026-10-19T12:00:00.000Z'));
  assert.match(ics, /BEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY/);
  assert.match(ics, /SUMMARY:Consulta/);
});

test('buildSyncPayload contains only the nine approved cloud fields', () => {
  const payload = core.buildSyncPayload({
    meds: [], events: [], logs: [], dailyEntries: {}, name: 'Lince', contact: '',
    pharmacyName: '', pharmacyPhone: '', hideMedicationNameInNotification: true,
    notificationsEnabled: true, notificationSent: ['local-only'], pin: '1234',
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'contact', 'dailyEntries', 'events', 'hideMedicationNameInNotification', 'logs',
    'meds', 'name', 'pharmacyName', 'pharmacyPhone',
  ].sort());
  assert.equal(payload.pin, undefined);
  assert.equal(payload.notificationsEnabled, undefined);
});

test('applySyncPayload validates data and preserves device-only settings', () => {
  const defaults = {
    schemaVersion: 2, meds: [], events: [], logs: [], dailyEntries: {}, name: '', contact: '',
    pharmacyName: '', pharmacyPhone: '', notificationsEnabled: false,
    hideMedicationNameInNotification: true, notificationSent: [], lastBackupAt: '',
    onboardingComplete: false, dataConsentAt: '',
  };
  const local = {
    ...defaults, notificationsEnabled: true, notificationSent: ['local-reminder'],
    lastBackupAt: 'local-backup', dataConsentAt: 'local-consent', onboardingComplete: false,
    localPin: 'must-not-be-overwritten',
  };
  const result = core.applySyncPayload(local, {
    meds: [{ id: 'm1', name: 'Losartana', mode: 'daily', stock: 9, times: ['08:00'] }],
    events: [], logs: [], dailyEntries: {}, name: 'Nuvem', contact: '', pharmacyName: '',
    pharmacyPhone: '', hideMedicationNameInNotification: false, localPin: 'attacker',
  }, defaults);
  assert.equal(result.name, 'Nuvem');
  assert.equal(result.notificationsEnabled, true);
  assert.deepEqual(result.notificationSent, ['local-reminder']);
  assert.equal(result.lastBackupAt, 'local-backup');
  assert.equal(result.dataConsentAt, 'local-consent');
  assert.equal(result.onboardingComplete, true);
  assert.equal(result.localPin, 'must-not-be-overwritten');
  assert.throws(() => core.applySyncPayload(local, { meds: 'inválido', events: [], logs: [] }, defaults));
});

test('hasLocalData and summarizeForConflict report snapshot counts', () => {
  assert.equal(core.hasLocalData({ meds: [], events: [], logs: [], dailyEntries: {} }), false);
  const value = { meds: [{}], logs: [{}, {}], events: [{}], dailyEntries: { '2026-10-21': {}, '2026-10-20': {} } };
  assert.equal(core.hasLocalData(value), true);
  assert.deepEqual(core.summarizeForConflict(value), { meds: 1, logs: 2, events: 1, entries: 2 });
  assert.deepEqual(core.summarizeForConflict({}), { meds: 0, logs: 0, events: 0, entries: 0 });
});

test('decideSyncAction covers account, version, dirty and data combinations', () => {
  const cases = [
    [{ serverVersion: 0, lastSyncedVersion: 0, dirty: false, hasLocalData: false, sameAccount: false }, 'noop'],
    [{ serverVersion: 3, lastSyncedVersion: 0, dirty: false, hasLocalData: false, sameAccount: false }, 'pull'],
    [{ serverVersion: 3, lastSyncedVersion: 0, dirty: false, hasLocalData: true, sameAccount: false }, 'conflict'],
    [{ serverVersion: 0, lastSyncedVersion: 0, dirty: false, hasLocalData: true, sameAccount: false }, 'conflict'],
    [{ serverVersion: 0, lastSyncedVersion: 0, dirty: false, hasLocalData: true, sameAccount: true }, 'upload'],
    [{ serverVersion: 0, lastSyncedVersion: 4, dirty: false, hasLocalData: false, sameAccount: true }, 'conflict'],
    [{ serverVersion: 0, lastSyncedVersion: 0, dirty: false, hasLocalData: false, sameAccount: true }, 'noop'],
    [{ serverVersion: 3, lastSyncedVersion: 0, dirty: false, hasLocalData: false, sameAccount: true }, 'pull'],
    [{ serverVersion: 3, lastSyncedVersion: 0, dirty: true, hasLocalData: true, sameAccount: true }, 'conflict'],
    [{ serverVersion: 5, lastSyncedVersion: 4, dirty: false, hasLocalData: true, sameAccount: true }, 'pull'],
    [{ serverVersion: 5, lastSyncedVersion: 4, dirty: true, hasLocalData: true, sameAccount: true }, 'conflict'],
    [{ serverVersion: 4, lastSyncedVersion: 4, dirty: false, hasLocalData: true, sameAccount: true }, 'noop'],
    [{ serverVersion: 4, lastSyncedVersion: 4, dirty: true, hasLocalData: true, sameAccount: true }, 'upload'],
    [{ serverVersion: 2, lastSyncedVersion: 4, dirty: false, hasLocalData: true, sameAccount: true }, 'conflict'],
  ];
  for (const [input, expected] of cases) assert.equal(core.decideSyncAction(input), expected, JSON.stringify(input));
});

test('api client sends bearer token and returns JSON', async () => {
  const values = new Map([['checkmed.auth', JSON.stringify({ token: 'session-token' })]]);
  const storage = { getItem: key => values.get(key) || null, removeItem: key => values.delete(key) };
  let requestOptions;
  const client = api.createClient({
    apiBase: 'https://api.example.test/', storage,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.example.test/api/auth/me');
      requestOptions = options;
      return { ok: true, status: 200, json: async () => ({ accountId: 'abc' }) };
    },
  });
  assert.deepEqual(await client.request('/auth/me'), { accountId: 'abc' });
  assert.equal(requestOptions.headers.Authorization, 'Bearer session-token');
  assert.equal(requestOptions.cache, 'no-store');
});

test('api client clears auth on 401 and normalizes conflict versions', async () => {
  const values = new Map([['checkmed.auth', JSON.stringify({ token: 'session-token' })]]);
  const storage = { getItem: key => values.get(key) || null, removeItem: key => values.delete(key) };
  let expiredMessage = '';
  const unauthorized = api.createClient({
    apiBase: 'https://api.example.test', storage, onUnauthorized: message => { expiredMessage = message; },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'session_expired', message: 'backend' }) }),
  });
  await assert.rejects(unauthorized.request('/auth/me'), error => error.status === 401 && error.error === 'session_expired');
  assert.equal(values.has('checkmed.auth'), false);
  assert.match(expiredMessage, /seus dados deste aparelho continuam aqui/);
  const conflict = api.createClient({
    apiBase: 'https://api.example.test', storage,
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'sync_conflict', message: 'Conflito', serverVersion: 7 }) }),
  });
  await assert.rejects(conflict.request('/sync'), error => error.status === 409 && error.serverVersion === 7);
});

test('api client keeps an existing session on unauthenticated login errors', async () => {
  const values = new Map([['checkmed.auth', JSON.stringify({ token: 'existing-session' })]]);
  const storage = { getItem: key => values.get(key) || null, removeItem: key => values.delete(key) };
  const client = api.createClient({
    apiBase: 'https://api.example.test', storage,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' }) }),
  });
  await assert.rejects(client.request('/auth/login', { method: 'POST', auth: false, body: {} }), error => error.message === 'E-mail ou senha incorretos.');
  assert.equal(JSON.parse(values.get('checkmed.auth')).token, 'existing-session');
});

test('api client reports timeout when fetch does not finish', async () => {
  const client = api.createClient({ apiBase: 'https://api.example.test', timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(client.request('/auth/me'), error => error.error === 'timeout');
});
