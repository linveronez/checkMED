const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

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
