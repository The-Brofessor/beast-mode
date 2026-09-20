/* Tests for beast-core.js. Run with: node --test
   No dependencies: Node's built-in test runner and assert only. */

const test = require('node:test');
const assert = require('node:assert');
const C = require('./beast-core.js');

// ── helpers ────────────────────────────────────────────────────────────────

// ISO timestamp that lands on the intended LOCAL date and time, whatever
// timezone the test machine runs in.
function at(ymd, hh, mm) {
  const p = ymd.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), hh, mm, 0).toISOString();
}

function item(over) {
  return C.normalizeItem(Object.assign({
    id: 'x1', name: 'Zone 2', kind: 'habit', freq: 'daily',
    core: true, addedAt: '2026-09-01'
  }, over));
}

// ── dates ──────────────────────────────────────────────────────────────────

test('todayLocal returns YYYY-MM-DD', () => {
  assert.match(C.todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('localToDate does not shift across timezones', () => {
  // new Date('2026-09-19') parses as UTC midnight and reads as the 18th west
  // of Greenwich. The split-string form must not.
  assert.strictEqual(C.dateToLocal(C.localToDate('2026-09-19')), '2026-09-19');
});

test('localDateOf uses the local calendar date of a timestamp', () => {
  assert.strictEqual(C.localDateOf(at('2026-09-19', 23, 30)), '2026-09-19');
  assert.strictEqual(C.localDateOf(at('2026-09-19', 0, 15)), '2026-09-19');
});

test('addDays crosses month and year boundaries', () => {
  assert.strictEqual(C.addDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(C.addDays('2026-01-01', -1), '2025-12-31');
  assert.strictEqual(C.addDays('2028-02-28', 1), '2028-02-29'); // leap year
});

test('weekdayIndex is Monday-aligned', () => {
  assert.strictEqual(C.weekdayIndex('2026-09-14'), 0); // Monday
  assert.strictEqual(C.weekdayIndex('2026-09-20'), 6); // Sunday
});

test('getWeekDates starts on Monday regardless of the day given', () => {
  const fromSunday = C.getWeekDates('2026-09-20');
  assert.strictEqual(fromSunday[0], '2026-09-14');
  assert.strictEqual(fromSunday[6], '2026-09-20');
  assert.deepStrictEqual(C.getWeekDates('2026-09-16')[0], '2026-09-14');
});

test('daysBetween and datesBetween are inclusive and correct', () => {
  assert.strictEqual(C.daysBetween('2026-09-14', '2026-09-20'), 6);
  assert.strictEqual(C.datesBetween('2026-09-14', '2026-09-20').length, 7);
});

test('minutesOfDay parses and rejects', () => {
  assert.strictEqual(C.minutesOfDay('08:00'), 480);
  assert.strictEqual(C.minutesOfDay('24:00'), null);
  assert.strictEqual(C.minutesOfDay(''), null);
  assert.strictEqual(C.minutesOfDay('nonsense'), null);
});

test('formatDueBy renders 12-hour times', () => {
  assert.strictEqual(C.formatDueBy('08:00'), '8am');
  assert.strictEqual(C.formatDueBy('21:30'), '9:30pm');
  assert.strictEqual(C.formatDueBy('12:00'), '12pm');
  assert.strictEqual(C.formatDueBy(''), '');
});

// ── log keys ───────────────────────────────────────────────────────────────

test('log key round trips', () => {
  const k = C.logKey('abc', '2026-09-19');
  assert.strictEqual(k, 'abc|2026-09-19');
  assert.deepStrictEqual(C.parseLogKey(k), { id: 'abc', date: '2026-09-19' });
});

test('log key rejects an id containing the separator', () => {
  assert.throws(() => C.logKey('a|b', '2026-09-19'), /Invalid item id/);
});

test('normalizeItem never produces an id containing the separator', () => {
  assert.strictEqual(C.normalizeItem({ id: 'bad|id', name: 'x' }).id.indexOf('|'), -1);
});

// ── normalizers ────────────────────────────────────────────────────────────

test('normalizeItem fills defaults for a bare object', () => {
  const it = C.normalizeItem({ name: 'Floss' }, { addedAt: '2026-09-01' });
  assert.strictEqual(it.kind, 'habit');
  assert.strictEqual(it.freq, 'daily');
  assert.strictEqual(it.addedAt, '2026-09-01');
  assert.deepStrictEqual(it.days, []);
  assert.deepStrictEqual(it.detail, {});
});

test('weekly with no days collapses to flexible', () => {
  const it = C.normalizeItem({ name: 'Sauna', freq: 'weekly', days: [] });
  assert.strictEqual(it.freq, 'flexible');
  assert.strictEqual(it.timesPerWeek, 1);
});

test('core defaults by kind when a draft omits it', () => {
  // A Brofessor draft that forgets `core` must still produce a meaningful
  // streak. Habits gate; exercises and supplements do not.
  assert.strictEqual(C.normalizeItem({ name: 'Zone 2', kind: 'habit' }).core, true);
  assert.strictEqual(C.normalizeItem({ name: 'Bench', kind: 'exercise' }).core, false);
  assert.strictEqual(C.normalizeItem({ name: 'Creatine', kind: 'supplement' }).core, false);
  // An explicit value always wins over the default.
  assert.strictEqual(C.normalizeItem({ name: 'Floss', kind: 'habit', core: false }).core, false);
  assert.strictEqual(C.normalizeItem({ name: 'Squat', kind: 'exercise', core: true }).core, true);
});

test('flexible and monthly items are forced non-core', () => {
  assert.strictEqual(C.normalizeItem({ name: 'a', freq: 'flexible', core: true }).core, false);
  assert.strictEqual(C.normalizeItem({ name: 'b', freq: 'monthly', core: true }).core, false);
});

test('exercise and supplement details are coerced to their kind', () => {
  const ex = C.normalizeItem({ name: 'Bench', kind: 'exercise', detail: { metric: 'bogus' } });
  assert.strictEqual(ex.detail.metric, 'sets_reps');
  assert.deepStrictEqual(ex.detail.target, {});

  const sup = C.normalizeItem({ name: 'Creatine', kind: 'supplement', detail: { dosage: '5g', timing: 'bogus' } });
  assert.strictEqual(sup.detail.dosage, '5g');
  assert.strictEqual(sup.detail.timing, 'morning');
});

test('an invalid dueBy is dropped rather than stored', () => {
  assert.strictEqual(C.normalizeItem({ name: 'a', dueBy: '99:99' }).dueBy, '');
  assert.strictEqual(C.normalizeItem({ name: 'a', dueBy: '08:00' }).dueBy, '08:00');
});

test('normalizeItems gives every item a unique id', () => {
  const list = C.normalizeItems([{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }]);
  assert.notStrictEqual(list[0].id, list[1].id);
});

test('normalizeGoals upgrades legacy strings and drops empties', () => {
  const goals = C.normalizeGoals(['Lose 15 lb', { text: 'Squat 315', term: 'long' }, { text: '  ' }]);
  assert.strictEqual(goals.length, 2);
  assert.strictEqual(goals[0].term, 'short');
  assert.strictEqual(goals[1].term, 'long');
  assert.ok(C.isValidId(goals[0].id));
});

// ── metrics and targets ────────────────────────────────────────────────────

test('formatTarget renders each metric and stays empty when unset', () => {
  assert.strictEqual(C.formatTarget({ metric: 'sets_reps', target: { sets: 3, reps: 12 } }), '3 x 12');
  assert.strictEqual(C.formatTarget({ metric: 'sets_reps_weight', target: { sets: 3, reps: 12, weight: 135 } }), '3 x 12 @ 135');
  assert.strictEqual(C.formatTarget({ metric: 'sets_reps_weight', target: { sets: 3, reps: 12 } }), '3 x 12');
  assert.strictEqual(C.formatTarget({ metric: 'time', target: { minutes: 20 } }), '20 min');
  assert.strictEqual(C.formatTarget({ metric: 'notes', target: {} }), '');
  assert.strictEqual(C.formatTarget({ metric: 'sets_reps', target: {} }), '');
  assert.strictEqual(C.formatTarget(null), '');
});

test('every metric has target fields and a label', () => {
  C.METRICS.forEach(m => {
    assert.ok(Array.isArray(C.targetFields(m)), m + ' has no target fields');
    assert.notStrictEqual(C.metricLabel(m), m, m + ' has no label');
  });
});

// ── scheduling ─────────────────────────────────────────────────────────────

test('addedAt excludes an item from earlier dates', () => {
  const it = item({ addedAt: '2026-09-10' });
  assert.strictEqual(C.isScheduled(it, '2026-09-09'), false);
  assert.strictEqual(C.isScheduled(it, '2026-09-10'), true);
});

test('weekly items land only on their chosen days', () => {
  const it = item({ freq: 'weekly', days: [0, 2] }); // Mon, Wed
  assert.strictEqual(C.isScheduled(it, '2026-09-14'), true);  // Mon
  assert.strictEqual(C.isScheduled(it, '2026-09-15'), false); // Tue
  assert.strictEqual(C.isScheduled(it, '2026-09-16'), true);  // Wed
});

test('flexible items owe no specific day but stay tappable', () => {
  const it = item({ freq: 'flexible', timesPerWeek: 3 });
  assert.strictEqual(C.isScheduled(it, '2026-09-14'), false);
  assert.strictEqual(C.isAvailable(it, '2026-09-14'), true);
});

// ── on-time ────────────────────────────────────────────────────────────────

test('an item with no dueBy is never late', () => {
  const it = item({ dueBy: '' });
  const e = { done: true, completedAt: at('2026-09-14', 23, 59) };
  assert.strictEqual(C.isOnTime(it, e, '2026-09-14'), true);
});

test('on-time compares against that date dueBy', () => {
  const it = item({ dueBy: '08:00' });
  assert.strictEqual(C.isOnTime(it, { done: true, completedAt: at('2026-09-14', 7, 30) }, '2026-09-14'), true);
  assert.strictEqual(C.isOnTime(it, { done: true, completedAt: at('2026-09-14', 8, 30) }, '2026-09-14'), false);
});

test('a back-filled tick is never on time, even before the due hour', () => {
  const it = item({ dueBy: '21:00' });
  // ticked Friday morning for Tuesday: earlier than 21:00 on the clock, but
  // the wrong day.
  const e = { done: true, completedAt: at('2026-09-18', 9, 0) };
  assert.strictEqual(C.isOnTime(it, e, '2026-09-15'), false);
});

// ── day results ────────────────────────────────────────────────────────────

test('a day with every core item done same-day is closed', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })];
  const log = {
    'a|2026-09-14': { done: true, completedAt: at('2026-09-14', 7, 0) },
    'b|2026-09-14': { done: true, completedAt: at('2026-09-14', 7, 5) }
  };
  const r = C.dayResult(items, log, '2026-09-14');
  assert.strictEqual(r.gate, 'closed');
  assert.strictEqual(r.perfectBonus, 20);           // 10 x 2 core
  assert.strictEqual(r.points, 2 * 20 + 20);        // base+ontime each, plus bonus
});

test('a missed core item breaks the day', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })];
  const log = { 'a|2026-09-14': { done: true, completedAt: at('2026-09-14', 7, 0) } };
  const r = C.dayResult(items, log, '2026-09-14');
  assert.strictEqual(r.gate, 'broken');
  assert.strictEqual(r.perfectBonus, 0);
});

test('a missed non-core item does not break the day', () => {
  const items = [item({ id: 'a' }), item({ id: 'b', core: false })];
  const log = { 'a|2026-09-14': { done: true, completedAt: at('2026-09-14', 7, 0) } };
  assert.strictEqual(C.dayResult(items, log, '2026-09-14').gate, 'closed');
});

test('a day with no core items scheduled is neutral and earns no bonus', () => {
  const items = [item({ id: 'a', core: false })];
  const log = { 'a|2026-09-14': { done: true, completedAt: at('2026-09-14', 7, 0) } };
  const r = C.dayResult(items, log, '2026-09-14');
  assert.strictEqual(r.gate, 'neutral');
  assert.strictEqual(r.perfectBonus, 0);
  assert.strictEqual(r.points, 20);
});

test('a back-filled item earns base only and leaves the day broken', () => {
  const items = [item({ id: 'a' })];
  const log = { 'a|2026-09-14': { done: true, completedAt: at('2026-09-18', 9, 0) } };
  const r = C.dayResult(items, log, '2026-09-14');
  assert.strictEqual(r.points, C.POINTS.base);   // no on-time, no bonus
  assert.strictEqual(r.gate, 'broken');
});

// ── streak ─────────────────────────────────────────────────────────────────

function perfectLog(items, dates, hour) {
  const log = {};
  dates.forEach(d => items.forEach(it => {
    if (C.isScheduled(it, d)) log[C.logKey(it.id, d)] = { done: true, completedAt: at(d, hour || 7, 0) };
  }));
  return log;
}

test('today is excluded from the streak', () => {
  const items = [item({ id: 'a', addedAt: '2026-09-14' })];
  const dates = C.datesBetween('2026-09-14', '2026-09-17');
  const log = perfectLog(items, dates);
  // Nothing logged for the 18th, but the 18th is "today" and is not judged.
  assert.strictEqual(C.currentStreak(items, log, '2026-09-18'), 4);
});

test('a broken day stops the streak', () => {
  const items = [item({ id: 'a', addedAt: '2026-09-14' })];
  const log = perfectLog(items, C.datesBetween('2026-09-14', '2026-09-17'));
  delete log['a|2026-09-16'];
  assert.strictEqual(C.currentStreak(items, log, '2026-09-18'), 1); // only the 17th
});

test('back-filling a broken day does not repair the streak', () => {
  const items = [item({ id: 'a', addedAt: '2026-09-14' })];
  const log = perfectLog(items, C.datesBetween('2026-09-14', '2026-09-17'));
  log['a|2026-09-16'] = { done: true, completedAt: at('2026-09-18', 9, 0) };
  assert.strictEqual(C.currentStreak(items, log, '2026-09-18'), 1);
});

test('adding an item mid-program does not zero an existing streak', () => {
  const zone2 = item({ id: 'a', addedAt: '2026-09-14' });
  const log = perfectLog([zone2], C.datesBetween('2026-09-14', '2026-09-17'));
  // Chris sends an update on the 17th adding a second core item.
  const floss = item({ id: 'b', addedAt: '2026-09-17' });
  log['b|2026-09-17'] = { done: true, completedAt: at('2026-09-17', 22, 0) };
  assert.strictEqual(C.currentStreak([zone2, floss], log, '2026-09-18'), 4);
});

test('bestStreak remembers the longest run', () => {
  const items = [item({ id: 'a', addedAt: '2026-09-01' })];
  const log = perfectLog(items, C.datesBetween('2026-09-01', '2026-09-14'));
  delete log['a|2026-09-10'];
  assert.strictEqual(C.bestStreak(items, log, '2026-09-15'), 9); // 1st-9th
});

// ── perfectWeek and levels ─────────────────────────────────────────────────

test('perfectWeek counts each frequency correctly', () => {
  const items = [
    item({ id: 'a', freq: 'daily' }),                      // 7 x 20
    item({ id: 'b', freq: 'weekly', days: [0, 2, 4] }),    // 3 x 20
    item({ id: 'c', freq: 'flexible', timesPerWeek: 2 }),  // 2 x 20
    item({ id: 'd', freq: 'monthly' })                     // 0
  ];
  assert.strictEqual(C.perfectWeek(items), (7 + 3 + 2) * 20);
});

test('perfectWeek excludes the perfect-day bonus so the ladder stays linear', () => {
  const small = [item({ id: 'a' })];
  const big = Array.from({ length: 10 }, (_, i) => item({ id: 'i' + i }));
  // Ten times the items means exactly ten times the perfect week.
  assert.strictEqual(C.perfectWeek(big), 10 * C.perfectWeek(small));
});

test('level thresholds follow the multiples and round to 50', () => {
  const t = C.levelThresholds(1660);
  assert.deepStrictEqual(t.map(x => x.rank),
    ['Lil Bro', 'Bro', 'Bro Bro', 'Broton Beam', 'Chief Brologist']);
  assert.strictEqual(t[0].points, 0);
  assert.strictEqual(t[1].points, 1650);      // 1660 rounded to nearest 50
  assert.strictEqual(t[4].points, 26550);     // 16 x 1660 = 26560 -> 26550
});

test('levelFor picks the highest threshold reached', () => {
  assert.strictEqual(C.levelFor(0, 1000).level, 1);
  assert.strictEqual(C.levelFor(1000, 1000).level, 2);
  assert.strictEqual(C.levelFor(8000, 1000).level, 4);
});

test('level ratchets so a plan change cannot demote a client', () => {
  // Client earned level 4, then the plan grew and thresholds rose.
  const r = C.levelFor(8000, 2000, 4);
  assert.strictEqual(r.level, 4);
  assert.strictEqual(r.rank, 'Broton Beam');
});

// ── codec ──────────────────────────────────────────────────────────────────

test('payload round trips through the base64 fallback', () => {
  const items = C.normalizeItems([{ name: 'Zone 2', core: true }]);
  const code = C.encodePayload('plan', { items: items, goals: [] });
  assert.ok(code.startsWith('BMPLAN:'));      // no LZString in Node
  const out = C.decodePayload(code);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.kind, 'plan');
  assert.strictEqual(out.data.v, C.PAYLOAD_VERSION);
  assert.strictEqual(out.data.items[0].name, 'Zone 2');
});

test('the wire format survives a full round trip', () => {
  const items = C.normalizeItems([
    { name: 'Zone 2', kind: 'habit', core: true, dueBy: '08:00', group: 'Morning',
      notes: 'Conversation pace.', addedAt: '2026-09-14' },
    { name: 'Bench', kind: 'exercise', freq: 'weekly', days: [0, 3],
      detail: { metric: 'sets_reps_weight', target: { sets: 3, reps: 12, weight: 135 } },
      trainerNotes: 'Two in reserve.', addedAt: '2026-09-14' },
    { name: 'Creatine', kind: 'supplement', detail: { dosage: '5g', timing: 'morning' },
      addedAt: '2026-09-14' }
  ]);
  const out = C.decodePayload(C.encodePayload('plan', { items }));
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.data.items, items);
});

test('an explicitly non-core habit does not come back gating', () => {
  // `core` defaults true for habits, so the wire format must write false
  // rather than omit it.
  const items = C.normalizeItems([{ name: 'Floss', kind: 'habit', core: false, addedAt: '2026-09-14' }]);
  const out = C.decodePayload(C.encodePayload('plan', { items }));
  assert.strictEqual(out.data.items[0].core, false);
});

test('the wire format is smaller than the expanded shape', () => {
  const items = C.normalizeItems(Array.from({ length: 20 }, (_, i) => ({
    name: 'Item ' + i, kind: 'habit', group: 'Morning',
    notes: 'Conversation pace, hands off the rails.', addedAt: '2026-09-14'
  })));
  const packed = JSON.stringify(items.map(C.packItem)).length;
  const raw = JSON.stringify(items).length;
  assert.ok(packed < raw * 0.8, `expected packed (${packed}) well under raw (${raw})`);
});

test('an already-expanded item still loads, so a hand-written draft works', () => {
  const draft = { name: 'Steps', kind: 'habit', freq: 'daily', core: true, addedAt: '2026-09-14' };
  assert.strictEqual(C.unpackItem(draft), draft);
});

test('shareUrlLength measures the whole link', () => {
  const base = 'https://the-brofessor.github.io/beast-mode/';
  assert.strictEqual(C.shareUrlLength(base, 'ABC'), base.length + 8 + 3);
  assert.ok(C.SHARE_LIMITS.warnUrl < C.SHARE_LIMITS.maxUrl);
});

test('a payload from a newer app is refused with a readable message', () => {
  const code = 'BMPLAN:' + Buffer.from(JSON.stringify({ v: 99 }), 'utf8').toString('base64');
  const out = C.decodePayload(code);
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /newer version/);
});

test('garbage input is refused rather than throwing', () => {
  assert.strictEqual(C.decodePayload('hello').ok, false);
  assert.strictEqual(C.decodePayload('BMPLAN:@@@not-base64@@@').ok, false);
  assert.strictEqual(C.decodePayload('').ok, false);
  assert.strictEqual(C.decodePayload(null).ok, false);
});

test('every payload kind has a prefix and decodes back to its kind', () => {
  Object.keys(C.PREFIXES).forEach(kind => {
    const out = C.decodePayload(C.encodePayload(kind, { x: 1 }));
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.kind, kind);
  });
});

// ── escaping ───────────────────────────────────────────────────────────────

test('escapeHtml neutralises a script tag from a pasted draft', () => {
  assert.strictEqual(
    C.escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
});
