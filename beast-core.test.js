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
  assert.strictEqual(C.formatTarget({ metric: 'duration', target: { minutes: 20 } }), '20 min');
  assert.strictEqual(C.formatTarget({ metric: 'duration', target: { seconds: 45 } }), '45 sec');
  assert.strictEqual(C.formatTarget({ metric: 'duration', target: { minutes: 12, seconds: 30 } }), '12:30');
  assert.strictEqual(C.formatTarget({ metric: 'sets_duration', target: { sets: 3, seconds: 45 } }), '3 x 45 sec');
  assert.strictEqual(C.formatTarget({ metric: 'distance_time', target: { distance: 1.5, minutes: 12, seconds: 30 } }), '1.5 in 12:30');
  assert.strictEqual(C.formatTarget({ metric: 'makes_attempts', target: { makes: 8, attempts: 10 } }), '8 / 10');
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

test('the vocabulary matches what brofessor-methods.md tells the coach to write', () => {
  // Renaming either list silently invalidates every plan draft. These are the
  // names the methods file uses, so they are part of the contract.
  ['reps','sets_reps','sets_reps_weight','duration','sets_duration',
   'distance_time','makes_attempts','notes'].forEach(m => {
    assert.ok(C.METRICS.indexOf(m) !== -1, 'missing metric ' + m);
  });
  ['morning','pre-workout','intra-workout','post-workout',
   'evening','before-bed','with-meals'].forEach(t => {
    assert.ok(C.TIMINGS.indexOf(t) !== -1, 'missing timing ' + t);
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

// ── the app page ───────────────────────────────────────────────────────────

test('every inline script in index.html parses', () => {
  // One stray apostrophe in a single-quoted string stops the whole app from
  // starting, and nothing else in this suite loads the page.
  const html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 2, 'expected the theme script and the app script');
  scripts.forEach((code, i) => {
    assert.doesNotThrow(() => new Function(code), 'inline script ' + i + ' does not parse');
  });
});

// ── adults only ────────────────────────────────────────────────────────────

test('ageOn counts whole years and handles a birthday not yet reached', () => {
  assert.strictEqual(C.ageOn('2008-09-21', '2026-09-21'), 18);   // 18 today
  assert.strictEqual(C.ageOn('2008-09-22', '2026-09-21'), 17);   // 18 tomorrow
  assert.strictEqual(C.ageOn('1976-10-05', '2026-09-21'), 49);
  assert.strictEqual(C.ageOn('not a date', '2026-09-21'), null);
  assert.strictEqual(C.ageOn('', '2026-09-21'), null);
});

test('isUnderAge turns away under-18s by stated age or birthday', () => {
  const today = '2026-09-21';
  assert.strictEqual(C.MIN_AGE, 18);
  assert.strictEqual(C.isUnderAge({ age: 17 }, today), true);
  assert.strictEqual(C.isUnderAge({ age: '17' }, today), true);
  assert.strictEqual(C.isUnderAge({ age: 18 }, today), false);
  assert.strictEqual(C.isUnderAge({ age: 30, birthday: '2010-01-01' }, today), true);   // birthday wins when younger
  assert.strictEqual(C.isUnderAge({ birthday: '2008-09-21' }, today), false);
  assert.strictEqual(C.isUnderAge({}, today), false);           // blank is not a block
  assert.strictEqual(C.isUnderAge({ age: '' }, today), false);
});

// ── display labels ─────────────────────────────────────────────────────────

test('every timing has a client-facing label', () => {
  // A new timing added without a label would fall back to machine wording.
  C.TIMINGS.forEach(t => {
    assert.ok(C.TIMING_LABELS[t], 'no label for timing ' + t);
    assert.strictEqual(C.timingLabel(t), C.TIMING_LABELS[t]);
  });
});

test('itemSummary says how much and when, never the kind', () => {
  const [bench, creatine, mag, plank, walk] = C.normalizeItems([
    { name: 'Bench', kind: 'exercise', detail: { metric: 'sets_reps_weight', target: { sets: 3, reps: 12, weight: 135 } } },
    { name: 'Creatine', kind: 'supplement', detail: { dosage: '5g', timing: 'morning' } },
    { name: 'Magnesium', kind: 'supplement', detail: { timing: 'before-bed' } },
    { name: 'Plank', kind: 'exercise', detail: { metric: 'sets_duration', target: { sets: 3, seconds: 30 } } },
    { name: 'Walk', kind: 'habit' }
  ]);
  assert.strictEqual(C.itemSummary(bench), '3 × 12 at 135 lb');
  assert.strictEqual(C.itemSummary(creatine), '5g, in the morning');
  assert.strictEqual(C.itemSummary(mag), 'Before bed');
  assert.strictEqual(C.itemSummary(plank), '3 × 30 sec');
  assert.strictEqual(C.itemSummary(walk), '');
});

test('the plain target the dashboard reads is unchanged', () => {
  const d = { metric: 'sets_reps_weight', target: { sets: 3, reps: 12, weight: 135 } };
  assert.strictEqual(C.formatTarget(d), '3 x 12 @ 135');
  assert.strictEqual(C.formatTarget({ metric: 'sets_reps_weight', target: { sets: 3, reps: 12 } }), '3 x 12');
});

test('an unknown timing still reads as words', () => {
  assert.strictEqual(C.timingLabel('post-run'), 'Post run');
  assert.strictEqual(C.timingLabel(''), '');
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

// ── Brofessor drafts ───────────────────────────────────────────────────────

const GOOD_DRAFT = {
  items: [
    { name: 'Zone 2, 20 min fasted', kind: 'habit', group: 'Morning', core: true, dueBy: '08:00' },
    { name: 'Barbell Bench Press', kind: 'exercise', group: 'Push Day', freq: 'weekly', days: [0, 3],
      detail: { metric: 'sets_reps_weight', target: { sets: 3, reps: 12, weight: 135 } } },
    { name: 'Creatine 5g', kind: 'supplement', group: 'Morning', detail: { dosage: '5g', timing: 'morning' } }
  ],
  goals: [{ text: 'Lose 17 lb before the PFRA', term: 'short' }]
};

test('a clean draft validates and normalizes', () => {
  const r = C.validateDraft(GOOD_DRAFT);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.goals.length, 1);
  assert.strictEqual(r.items[0].core, true);
});

test('a draft can be pasted as a JSON string', () => {
  assert.strictEqual(C.validateDraft(JSON.stringify(GOOD_DRAFT)).ok, true);
});

test('broken JSON is refused with a readable message', () => {
  const r = C.validateDraft('{ "items": [ }');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /valid JSON/);
});

test('an empty or missing items list is refused', () => {
  assert.match(C.validateDraft({ items: [] }).errors[0], /no "items" list/);
  assert.match(C.validateDraft({}).errors[0], /no "items" list/);
});

test('every bad field is named with the item it belongs to', () => {
  const r = C.validateDraft({ items: [
    { name: 'Bad kind', kind: 'stretching' },
    { name: 'Bad freq', freq: 'fortnightly' },
    { name: 'Bad time', dueBy: '25:00' },
    { name: 'Bad day', freq: 'weekly', days: [0, 9] },
    { name: 'Bad metric', kind: 'exercise', detail: { metric: 'vibes' } },
    { name: 'Bad timing', kind: 'supplement', detail: { timing: 'whenever' } },
    { kind: 'habit' }
  ] });
  assert.strictEqual(r.ok, false);
  const joined = r.errors.join(' | ');
  assert.match(joined, /"Bad kind": kind "stretching"/);
  assert.match(joined, /"Bad freq": freq "fortnightly"/);
  assert.match(joined, /"Bad time": dueBy "25:00"/);
  assert.match(joined, /"Bad day": day "9"/);
  assert.match(joined, /"Bad metric": metric "vibes"/);
  assert.match(joined, /"Bad timing": timing "whenever"/);
  assert.match(joined, /Item 7 has no name/);
});

test('re-importing the same draft is a no-op', () => {
  const first = C.mergeDraft([], C.validateDraft(GOOD_DRAFT).items, '2026-09-14');
  const again = C.mergeDraft(first.items, C.validateDraft(GOOD_DRAFT).items, '2026-09-20');
  assert.deepStrictEqual(again.added, []);
  assert.deepStrictEqual(again.removed, []);
  assert.deepStrictEqual(again.changed, []);
  assert.strictEqual(again.kept.length, 3);
  // Ids and addedAt survive, so the client's log and streak survive with them.
  assert.deepStrictEqual(again.items.map(i => i.id), first.items.map(i => i.id));
  assert.ok(again.items.every(i => i.addedAt === '2026-09-14'));
});

test('a draft reports what it adds, changes and removes', () => {
  const first = C.mergeDraft([], C.validateDraft(GOOD_DRAFT).items, '2026-09-14');
  const edited = JSON.parse(JSON.stringify(GOOD_DRAFT));
  edited.items[0].dueBy = '07:30';                 // changed
  edited.items.push({ name: 'Floss', kind: 'habit', core: false });  // added
  edited.items.splice(2, 1);                        // Creatine removed

  const r = C.mergeDraft(first.items, C.validateDraft(edited).items, '2026-09-20');
  assert.deepStrictEqual(r.changed, ['Zone 2, 20 min fasted']);
  assert.deepStrictEqual(r.added, ['Floss']);
  assert.deepStrictEqual(r.removed, ['Creatine 5g']);
  // The new item starts today; the changed one keeps its original date.
  assert.strictEqual(r.items.filter(i => i.name === 'Floss')[0].addedAt, '2026-09-20');
  assert.strictEqual(r.items[0].addedAt, '2026-09-14');
});

test('draft matching ignores case and stray spacing', () => {
  const first = C.mergeDraft([], C.validateDraft(GOOD_DRAFT).items, '2026-09-14');
  const retyped = { items: [{ name: '  zone 2, 20 MIN FASTED ', kind: 'habit', core: true, dueBy: '08:00' }] };
  const r = C.mergeDraft(first.items, C.validateDraft(retyped).items, '2026-09-20');
  assert.deepStrictEqual(r.added, []);
  assert.strictEqual(r.items[0].addedAt, '2026-09-14');
});

// ── escaping ───────────────────────────────────────────────────────────────

test('escapeHtml neutralises a script tag from a pasted draft', () => {
  assert.strictEqual(
    C.escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
});

// ── daily report ───────────────────────────────────────────────────────────

test('a report carries only that day and computes its own percentages', () => {
  const items = C.normalizeItems([
    { name: 'Zone 2', kind: 'habit', core: true, dueBy: '08:00', addedAt: '2026-09-14' },
    { name: 'Steps', kind: 'habit', core: true, dueBy: '21:00', addedAt: '2026-09-14' },
    { name: 'Floss', kind: 'habit', core: false, dueBy: '22:30', addedAt: '2026-09-14' }
  ]);
  const log = {};
  // Two days of history; only the second should travel.
  items.forEach(it => { log[C.logKey(it.id, '2026-09-15')] = { done: true, completedAt: at('2026-09-15', 7, 0) }; });
  log[C.logKey(items[0].id, '2026-09-16')] = { done: true, completedAt: at('2026-09-16', 7, 0) };   // on time
  log[C.logKey(items[1].id, '2026-09-16')] = { done: true, completedAt: at('2026-09-16', 22, 0) };  // late

  const r = C.buildReport(items, log, '2026-09-16', { name: 'Vince', gratitude: 'Slept 8 hours' });
  assert.strictEqual(Object.keys(r.entries).length, 2);
  assert.strictEqual(r.stats.scheduled, 3);
  assert.strictEqual(r.stats.done, 2);
  assert.strictEqual(r.stats.onTime, 1);
  assert.strictEqual(r.stats.gate, 'closed');      // both core items done same-day
  assert.strictEqual(r.gratitude, 'Slept 8 hours');

  const s = C.reportSummary(r);
  assert.strictEqual(s.completion, 67);
  assert.strictEqual(s.onTime, 50);
});

test('a missed core item shows as a broken day in the report', () => {
  const items = C.normalizeItems([
    { name: 'Zone 2', kind: 'habit', core: true, addedAt: '2026-09-14' },
    { name: 'Steps', kind: 'habit', core: true, addedAt: '2026-09-14' }
  ]);
  const log = { [C.logKey(items[0].id, '2026-09-16')]: { done: true, completedAt: at('2026-09-16', 7, 0) } };
  const r = C.buildReport(items, log, '2026-09-16', {});
  assert.strictEqual(r.stats.gate, 'broken');
  assert.strictEqual(C.reportSummary(r).completion, 50);
});

test('a day with nothing scheduled reports 100 rather than dividing by zero', () => {
  const items = C.normalizeItems([
    { name: 'Leg day', kind: 'exercise', freq: 'weekly', days: [0], addedAt: '2026-09-14' }
  ]);
  const r = C.buildReport(items, {}, '2026-09-16', {});   // a Wednesday
  assert.strictEqual(r.stats.scheduled, 0);
  const s = C.reportSummary(r);
  assert.strictEqual(s.completion, 100);
  assert.strictEqual(s.onTime, 100);
});

test('a report round trips through the payload codec', () => {
  const items = C.normalizeItems([{ name: 'Zone 2', kind: 'habit', core: true, addedAt: '2026-09-14' }]);
  const log = { [C.logKey(items[0].id, '2026-09-16')]: { done: true, completedAt: at('2026-09-16', 7, 0) } };
  const r = C.buildReport(items, log, '2026-09-16', { name: 'Vince', gratitude: 'Coffee' });
  const out = C.decodePayload(C.encodePayload('report', r));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.kind, 'report');
  assert.strictEqual(out.data.gratitude, 'Coffee');
  assert.strictEqual(out.data.stats.done, 1);
});

test('a code is pulled out of a pasted text message', () => {
  const code = C.encodePayload('report', { date: '2026-09-20', stats: { done: 4 } });
  const sms = 'Vince - 2026-09-20\n4/6 done, 0 day streak\nGrateful for: sleep\n\n' + code;
  assert.strictEqual(C.extractCode(sms), code);
  assert.strictEqual(C.decodePayload(C.extractCode(sms)).ok, true);
  // A bare code passes through untouched, and prose with no code is returned as-is.
  assert.strictEqual(C.extractCode(code), code);
  assert.strictEqual(C.extractCode('  hello  '), 'hello');
});

// ── ancillaries ────────────────────────────────────────────────────────────

test('ancillary is a kind with its own detail and is non-core by default', () => {
  const a = C.normalizeItem({ name: 'Zepbound', kind: 'ancillary', freq: 'weekly', days: [1],
    detail: { dose: '7.5mg', prescriber: 'Dr Reyes', followUp: '2026-11-02', junk: 'x' } });
  assert.strictEqual(a.kind, 'ancillary');
  assert.strictEqual(a.core, false);
  assert.deepStrictEqual(a.detail, { dose: '7.5mg', prescriber: 'Dr Reyes', followUp: '2026-11-02' });
  assert.strictEqual(C.detailLine(a), '7.5mg');
});

test('appending ancillary did not shift the other kinds on the wire', () => {
  // The wire format stores kind as an index, so the first three must not move.
  assert.strictEqual(C.KINDS.indexOf('exercise'), 0);
  assert.strictEqual(C.KINDS.indexOf('supplement'), 1);
  assert.strictEqual(C.KINDS.indexOf('habit'), 2);
  assert.strictEqual(C.KINDS.indexOf('ancillary'), 3);
});

test('an ancillary round trips through the wire format', () => {
  const items = C.normalizeItems([{ name: 'TRT', kind: 'ancillary', freq: 'weekly', days: [4],
    detail: { dose: '100mg', prescriber: 'Dr Reyes', followUp: '2026-12-01' }, addedAt: '2026-09-14' }]);
  const out = C.decodePayload(C.encodePayload('plan', { items }));
  assert.deepStrictEqual(out.data.items, items);
});

test('a draft with a malformed ancillary follow-up is rejected by name', () => {
  const r = C.validateDraft({ items: [
    { name: 'Zepbound', kind: 'ancillary', detail: { dose: '7.5mg', followUp: 'next month' } }
  ] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /"Zepbound": followUp "next month"/);
});

test('detailLine covers every kind', () => {
  C.KINDS.forEach(k => {
    assert.strictEqual(typeof C.detailLine(C.normalizeItem({ name: 'x', kind: k })), 'string');
  });
});

// ── reminders ──────────────────────────────────────────────────────────────

const REMINDER_ITEMS = () => C.normalizeItems([
  { name: 'Zone 2', kind: 'habit', core: true, dueBy: '08:00', addedAt: '2026-09-14' },
  { name: 'Weigh in', kind: 'habit', core: true, dueBy: '08:00', addedAt: '2026-09-14' },
  { name: 'Steps', kind: 'habit', core: true, dueBy: '21:00', addedAt: '2026-09-14' },
  { name: 'Bench', kind: 'exercise', freq: 'weekly', days: [0], addedAt: '2026-09-14' }
]);

test('reminder slots are the distinct due-by times, in order', () => {
  assert.deepStrictEqual(C.reminderSlots(REMINDER_ITEMS()), ['08:00', '21:00']);
  assert.deepStrictEqual(C.reminderSlots([]), []);
});

test('a slot lists only what is still outstanding', () => {
  const items = REMINDER_ITEMS();
  const log = {};
  assert.strictEqual(C.dueAtSlot(items, log, '2026-09-16', '08:00').length, 2);
  // Finish one and it drops out; finish both and the slot is silent.
  log[C.logKey(items[0].id, '2026-09-16')] = { done: true, completedAt: at('2026-09-16', 7, 0) };
  assert.strictEqual(C.dueAtSlot(items, log, '2026-09-16', '08:00').length, 1);
  log[C.logKey(items[1].id, '2026-09-16')] = { done: true, completedAt: at('2026-09-16', 7, 5) };
  assert.strictEqual(C.dueAtSlot(items, log, '2026-09-16', '08:00').length, 0);
});

test('a slot ignores items not scheduled that day', () => {
  const items = C.normalizeItems([
    { name: 'Leg day', kind: 'exercise', freq: 'weekly', days: [0], dueBy: '17:00', addedAt: '2026-09-14' }
  ]);
  assert.strictEqual(C.dueAtSlot(items, {}, '2026-09-14', '17:00').length, 1);  // Monday
  assert.strictEqual(C.dueAtSlot(items, {}, '2026-09-16', '17:00').length, 0);  // Wednesday
});

test('a slot ignores an item added after the date', () => {
  const items = C.normalizeItems([
    { name: 'Floss', kind: 'habit', dueBy: '22:30', addedAt: '2026-09-20' }
  ]);
  assert.strictEqual(C.dueAtSlot(items, {}, '2026-09-16', '22:30').length, 0);
  assert.strictEqual(C.dueAtSlot(items, {}, '2026-09-20', '22:30').length, 1);
});

test('reminder text names one item and counts the rest', () => {
  const items = REMINDER_ITEMS();
  assert.strictEqual(C.reminderText(C.dueAtSlot(items, {}, '2026-09-16', '08:00'), '08:00'),
    'Zone 2 and 1 more, due by 8am');
  assert.strictEqual(C.reminderText(C.dueAtSlot(items, {}, '2026-09-16', '21:00'), '21:00'),
    'Steps, due by 9pm');
  assert.strictEqual(C.reminderText([], '08:00'), '');
});

test('quiet hours handle a window that wraps past midnight', () => {
  const q = { from: '22:00', to: '07:00' };
  assert.strictEqual(C.inQuietHours('23:30', q), true);
  assert.strictEqual(C.inQuietHours('02:00', q), true);
  assert.strictEqual(C.inQuietHours('08:00', q), false);
  assert.strictEqual(C.inQuietHours('21:59', q), false);
  // A same-day window still works, and no window means never quiet.
  assert.strictEqual(C.inQuietHours('13:00', { from: '12:00', to: '14:00' }), true);
  assert.strictEqual(C.inQuietHours('13:00', null), false);
});

// ── trainer backup ─────────────────────────────────────────────────────────

const ROSTER = () => ({ clients: [
  { id: 'c1', name: 'Vince', items: C.normalizeItems([{ name: 'Zone 2', kind: 'habit', addedAt: '2026-09-14' }]),
    goals: C.normalizeGoals([{ text: 'Pass the PFRA', term: 'short' }]),
    profile: { name: 'Vince', weight: 202 }, reports: { '2026-09-19': { date: '2026-09-19', stats: { done: 5 } } } },
  { id: 'c2', name: 'Dana', items: [], goals: [], profile: {}, reports: {} }
] });

test('a backup round trips the whole roster', () => {
  const file = JSON.stringify(C.buildBackup(ROSTER(), '2.7.0'));
  const r = C.readBackup(file);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.clients.length, 2);
  assert.strictEqual(r.clients[0].name, 'Vince');
  assert.strictEqual(r.clients[0].items[0].addedAt, '2026-09-14');   // dates survive
  assert.strictEqual(r.clients[0].goals[0].text, 'Pass the PFRA');
  assert.deepStrictEqual(Object.keys(r.clients[0].reports), ['2026-09-19']);
});

test('a restore refuses anything that is not a trainer backup', () => {
  assert.match(C.readBackup('not json').error, /not valid JSON/);
  assert.match(C.readBackup('{}').error, /not a trainer backup/);
  assert.match(C.readBackup(JSON.stringify({ type: C.BACKUP_TYPE, v: 99, clients: [] })).error, /newer version/);
  assert.match(C.readBackup(JSON.stringify({ type: C.BACKUP_TYPE, v: 2 })).error, /no client list/);
  // A client payload is not a trainer backup, however similar it looks.
  assert.strictEqual(C.readBackup(JSON.stringify({ v: 2, items: [] })).ok, false);
});

test('a damaged client in a backup is repaired rather than dropped', () => {
  const r = C.readBackup(JSON.stringify({
    type: C.BACKUP_TYPE, v: 2,
    clients: [{ id: 'bad|id', items: null, goals: ['Lose 10 lb'] }]
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.clients[0].id.indexOf('|'), -1);
  assert.strictEqual(r.clients[0].name, 'Unnamed');
  assert.deepStrictEqual(r.clients[0].items, []);
  assert.strictEqual(r.clients[0].goals[0].text, 'Lose 10 lb');
});

test('the diff says what a restore would add, overwrite and leave behind', () => {
  const current = ROSTER().clients;
  const incoming = [
    { id: 'c1', name: 'Vince' },      // already here
    { id: 'c3', name: 'Marcus' }      // new
  ];                                   // c2 Dana is only in the browser
  const d = C.backupDiff(current, incoming);
  assert.deepStrictEqual(d.overlap, ['Vince']);
  assert.deepStrictEqual(d.add, ['Marcus']);
  assert.deepStrictEqual(d.onlyHere, ['Dana']);
});

test('the filename carries the local date', () => {
  assert.strictEqual(C.backupFilename(new Date(2026, 8, 20)), 'beast-mode-backup-2026-09-20.json');
});

test('daysSince measures staleness in local days', () => {
  assert.strictEqual(C.daysSince('2026-09-14T09:00:00Z', '2026-09-20'), 6);
  assert.strictEqual(C.daysSince(null), null);
});
