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

test('linkFromText finds a long link, a short link, or a bare code in a pasted message', () => {
  const code = C.encodePayload('setup', { items: [], goals: [], profile: { name: 'Vince' } });
  const long = 'Here is your plan: https://app.thebrofessor.coach/#import=' + encodeURIComponent(code) + ' see you Monday';
  assert.deepStrictEqual(C.linkFromText(long), { code });
  assert.deepStrictEqual(C.linkFromText('Open this on your phone: https://thebrofessor.coach/p/BMVince On iPhone, add it first.'), { slug: 'bmvince' });
  assert.deepStrictEqual(C.linkFromText('thebrofessor.coach/p/x7k2'), { slug: 'x7k2' });
  assert.deepStrictEqual(C.linkFromText(code), { code });
  assert.deepStrictEqual(C.linkFromText('  ' + code + '\n'), { code });
  assert.deepStrictEqual(C.linkFromText('Before I build your plan: https://app.thebrofessor.coach/#intake=bmi_' + 'a'.repeat(36)), { intake: 'bmi_' + 'a'.repeat(36) }, 'an intake link pastes too');
  assert.strictEqual(C.linkFromText('#intake=not-a-token'), null);
  assert.strictEqual(C.linkFromText('yo whats up'), null);
  assert.strictEqual(C.linkFromText(''), null);
  assert.strictEqual(C.linkFromText(null), null);
  // A long link beats a short one in the same message: no server call needed.
  assert.deepStrictEqual(C.linkFromText('https://thebrofessor.coach/p/abc or https://app.thebrofessor.coach/#import=' + code), { code });
});

test('statusPayload says where the app is running, and validateStatus keeps it a yes, a no, or nothing', () => {
  const items = [{ id: 'z2', name: 'Zone 2', kind: 'habit', freq: 'daily', core: true, addedAt: '2026-09-01' }];
  const state = { items: C.normalizeItems(items), log: {}, perfectWeek: 7, earnedLevel: 1 };
  assert.strictEqual(C.statusPayload(state, { today: '2026-09-21', standalone: true }).standalone, true);
  assert.strictEqual(C.statusPayload(state, { today: '2026-09-21', standalone: false }).standalone, false);
  assert.strictEqual(C.statusPayload(state, { today: '2026-09-21' }).standalone, null, 'an older phone says nothing');
  const ok = raw => C.validateStatus(Object.assign(C.statusPayload(state, { today: '2026-09-21' }), raw));
  assert.strictEqual(ok({ standalone: true }).status.standalone, true);
  assert.strictEqual(ok({ standalone: false }).status.standalone, false);
  assert.strictEqual(ok({ standalone: undefined }).status.standalone, null);
  // Anything else is not a yes and not a no: it is nothing.
  assert.strictEqual(ok({ standalone: 'yes' }).status.standalone, null);
  assert.strictEqual(ok({ standalone: 1 }).status.standalone, null);
});

test('iosSafari is Safari on an iPhone, and nothing else that calls itself one', () => {
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  assert.strictEqual(C.iosSafari(SAFARI, true), true);
  // Chrome, Firefox, Edge, Opera and Google's own app on iOS cannot install anything.
  assert.strictEqual(C.iosSafari(SAFARI.replace('Safari/604.1', 'CriOS/140.0 Mobile/15E148 Safari/604.1'), true), false);
  assert.strictEqual(C.iosSafari(SAFARI.replace('Safari/604.1', 'FxiOS/140.0 Mobile/15E148 Safari/604.1'), true), false);
  assert.strictEqual(C.iosSafari(SAFARI.replace('Safari/604.1', 'EdgiOS/140.0 Mobile/15E148 Safari/604.1'), true), false);
  assert.strictEqual(C.iosSafari(SAFARI + ' GSA/350.0', true), false);
  // A link opened inside another app: no Add to Home Screen exists there.
  assert.strictEqual(C.iosSafari(SAFARI + ' [FBAN/FBIOS;FBAV/500.0]', true), false);
  assert.strictEqual(C.iosSafari(SAFARI + ' Instagram 350.0', true), false);
  // A web view with no standalone flag at all is not Safari either.
  assert.strictEqual(C.iosSafari(SAFARI, false), false);
  // Everything that is not an iPhone.
  assert.strictEqual(C.iosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/26.0 Safari/605.1.15', true), false);
  assert.strictEqual(C.iosSafari('Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile Safari/537.36', true), false);
  assert.strictEqual(C.iosSafari('', true), false);
  assert.strictEqual(C.iosSafari(), false);
});

test('hasAppHistory counts anything a client has done in this browser', () => {
  assert.strictEqual(C.hasAppHistory(null), false);
  assert.strictEqual(C.hasAppHistory({}), false);
  assert.strictEqual(C.hasAppHistory({ log: {}, weightLog: {}, coachLog: [], goalsAgreedAt: null }), false);
  assert.strictEqual(C.hasAppHistory({ log: { 'z2|2026-09-21': true } }), true);
  assert.strictEqual(C.hasAppHistory({ weightLog: { '2026-09-21': 212 } }), true);
  assert.strictEqual(C.hasAppHistory({ goalsAgreedAt: '2026-09-21T15:00:00Z' }), true);
  assert.strictEqual(C.hasAppHistory({ coachLog: [{ role: 'user', content: 'hi' }] }), true);
});

test('needsInstallFirst sends a fresh iPhone to the home screen before the welcome, and strands nobody', () => {
  const base = { ios: true, standalone: false, hasPlan: true, welcomeDone: false, hasHistory: false };
  assert.strictEqual(C.needsInstallFirst(base), true);
  // Already in the home-screen app, or not an iPhone at all: nothing changes.
  assert.strictEqual(C.needsInstallFirst({ ...base, standalone: true }), false);
  assert.strictEqual(C.needsInstallFirst({ ...base, ios: false }), false);
  // No plan yet: the paste box belongs there, not this screen.
  assert.strictEqual(C.needsInstallFirst({ ...base, hasPlan: false }), false);
  // The welcome is answered, or the client has ticked things in this browser:
  // sending them away would cost them the history that lives here.
  assert.strictEqual(C.needsInstallFirst({ ...base, welcomeDone: true }), false);
  assert.strictEqual(C.needsInstallFirst({ ...base, hasHistory: true }), false);
  // A client who chose to keep going in Safari is never asked again.
  assert.strictEqual(C.needsInstallFirst({ ...base, skipped: true }), false);
  assert.strictEqual(C.needsInstallFirst({}), false);
  assert.strictEqual(C.needsInstallFirst(), false);
});

test('the welcome on file is finished only when all four answers stand for today\'s wording', () => {
  const W = C.WELCOME.version;
  const full = {
    consent: { 1: { answer: 'yes', version: C.CONSENTS[1].version }, 2: { answer: 'no', version: C.CONSENTS[2].version } },
    sharing: { on: false, version: W }, nudges: { on: true, version: W }
  };
  assert.strictEqual(C.welcomeOnFile(full), true, 'a no to learning or sharing is still an answer');
  assert.strictEqual(C.welcomeOnFile({ ...full, sharing: null }), false, 'never answered sharing here');
  assert.strictEqual(C.welcomeOnFile({ ...full, nudges: { on: true, version: 'w2-2026-09-22' } }), false, 'an older welcome');
  assert.strictEqual(C.welcomeOnFile({ ...full, consent: { ...full.consent, 1: null } }), false);
  assert.strictEqual(C.welcomeOnFile({ ...full, consent: { ...full.consent, 2: { answer: 'yes', version: 'c2-old' } } }), false, 'old consent wording');
  assert.strictEqual(C.welcomeOnFile({ ...full, sharing: { on: 'yes', version: W } }), false, 'the answer must be a real one');
  assert.strictEqual(C.welcomeOnFile(null), false);
  assert.strictEqual(C.welcomeOnFile({}), false);
});

test('a held welcome stands only for the person who answered it', () => {
  const today = '2026-09-23';
  const held = { stamp: C.welcomeStamp(), at: '2026-09-23T17:00:00Z', intakeToken: 'bmi_a', clientId: 'dana' };
  // Their own intake link, and later their own plan.
  assert.strictEqual(C.heldWelcomeFits(held, { intakeToken: 'bmi_a', today }), true);
  assert.strictEqual(C.heldWelcomeFits(held, { clientId: 'dana', today }), true);
  // Someone else's link or plan on the same phone is asked again.
  assert.strictEqual(C.heldWelcomeFits(held, { intakeToken: 'bmi_b', today }), false);
  assert.strictEqual(C.heldWelcomeFits(held, { clientId: 'vince', today }), false);
  // A plan from an older dashboard carries no client id: ask.
  assert.strictEqual(C.heldWelcomeFits(held, { today }), false);
  assert.strictEqual(C.heldWelcomeFits({ ...held, clientId: '' }, { clientId: '', today }), false);
  // New wording in force, or held too long: ask.
  assert.strictEqual(C.heldWelcomeFits({ ...held, stamp: 'w1|c1|c2' }, { clientId: 'dana', today }), false);
  assert.strictEqual(C.heldWelcomeFits(held, { clientId: 'dana', today: '2026-12-22' }), true, 'day 90 still stands');
  assert.strictEqual(C.heldWelcomeFits(held, { clientId: 'dana', today: '2026-12-23' }), false, 'day 91 asks again');
  assert.strictEqual(C.heldWelcomeFits({ ...held, at: 'nonsense' }, { clientId: 'dana', today }), false);
  assert.strictEqual(C.heldWelcomeFits(null, { clientId: 'dana', today }), false);
  // The stamp moves with any of the three wordings.
  assert.ok(C.welcomeStamp().includes(C.WELCOME.version) && C.welcomeStamp().includes(C.CONSENTS[2].version));
});

test('needsInstallFirst sends a fresh iPhone with an intake link home first, under the same exits', () => {
  const base = { ios: true, standalone: false, intakeLink: true, welcomeDone: false, hasHistory: false };
  assert.strictEqual(C.needsInstallFirst(base), true);
  assert.strictEqual(C.needsInstallFirst({ ...base, standalone: true }), false);
  assert.strictEqual(C.needsInstallFirst({ ...base, ios: false }), false);
  // Started the form in this browser already, or chose to stay in Safari.
  assert.strictEqual(C.needsInstallFirst({ ...base, hasHistory: true }), false);
  assert.strictEqual(C.needsInstallFirst({ ...base, skipped: true }), false);
  assert.strictEqual(C.needsInstallFirst({ ...base, intakeLink: false }), false);
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

// ── the intake and the routine baseline ────────────────────────────────────

test('the intake asks the routine for a work day and a day off, keyed by pass, with no duplicate keys', () => {
  assert.strictEqual(C.INTAKE_VERSION, 2);
  const routine = C.routineSections();
  assert.deepStrictEqual(routine.map(s => s.pass), ['work', 'off', 'most']);
  assert.deepStrictEqual(routine.map(s => s.title), ['Your work day', 'Your day off', 'Typical Day']);
  assert.deepStrictEqual(C.INTAKE_SECTIONS.map(s => s.title), ['Personal Info', 'Goals', 'Your work day', 'Your day off', 'Typical Day', 'Training', 'Health', 'Your prescription', 'Tools', 'Music']);
  // Personal Info (Chris, 2026-09-23): date of birth, not age; pounds and inches; two buttons for sex.
  const you = C.INTAKE_SECTIONS[0];
  assert.deepStrictEqual(you.fields.map(f => f.key), ['firstName', 'lastName', 'birthday', 'sex', 'height', 'weight', 'goalWeight', 'waist', 'bodyFat', 'maxHr', 'household']);
  assert.strictEqual(C.profileFromIntake('Vince', { firstName: ' Vince ', lastName: 'Carter' }).name, 'Vince Carter', 'the typed name wins');
  assert.strictEqual(C.profileFromIntake('Vince', { firstName: '', lastName: '' }).name, 'Vince', 'the link\'s name stands when none was typed');
  assert.strictEqual(you.fields[2].type, 'date');
  assert.strictEqual(you.fields[3].type, 'choice');
  assert.match(you.fields.find(f => f.key === 'weight').label, /\(lb\)/);
  assert.match(you.fields.find(f => f.key === 'height').label, /\(inches\)/);
  assert.ok(C.INTAKE_LEGACY.age, 'an old age answer still prints');
  assert.strictEqual(C.INTAKE_SECTIONS[1].featured, true, 'the goals page is the one that matters');
  assert.ok(C.INTAKE_SECTIONS[1].lead);
  // Chris's additions and edits, 2026-09-23.
  for (const k of ['waist', 'household', 'workCooks', 'awayNights', 'calories', 'treadmill', 'hrMonitor', 'scale', 'bands', 'bodyTools', 'sports', 'hobbies', 'allergies',
                   'ancillariesYes', 'ancName', 'ancDose', 'ancSchedule', 'ancSince', 'ancSideEffectsYes', 'ancSideEffects', 'dietsTried', 'testComing', 'otherGoals', 'cleanOnly',
                   'foodAppYes', 'foodApp', 'treadmillYes', 'bandsYes', 'bodyToolsYes', 'musicType', 'bandsMusic', 'songs', 'currentTraining', 'gym', 'supplementsOpen', 'sleep', 'stress', 'toolsOpen']) {
    assert.ok(C.intakeFields().some(f => f.key === k), k + ' is asked');
  }
  for (const gone of ['ancPrescriber', 'testEvents', 'testDate', 'testScores', 'testVenue']) {
    assert.ok(!C.intakeFields().some(f => f.key === gone), gone + ' is not asked');
    assert.ok(C.INTAKE_LEGACY[gone], gone + ' still prints');
  }
  // The tools: a yes or no, then the detail.
  const tools = C.INTAKE_SECTIONS.find(s => s.title === 'Tools');
  assert.deepStrictEqual(C.visibleFields(tools, {}).map(f => f.key), ['foodAppYes', 'scale', 'treadmillYes', 'hrMonitor', 'bandsYes', 'bodyToolsYes', 'toolsOpen']);
  assert.deepStrictEqual(C.visibleFields(tools, { foodAppYes: 'yes', bandsYes: 'no', bodyToolsYes: 'yes' }).map(f => f.key),
    ['foodAppYes', 'foodApp', 'scale', 'treadmillYes', 'hrMonitor', 'bandsYes', 'bodyToolsYes', 'bodyTools', 'toolsOpen']);
  assert.deepStrictEqual(tools.fields.find(f => f.key === 'foodApp').options, ['MyFitnessPal', 'another app']);
  const rx = C.INTAKE_SECTIONS.find(s => s.title === 'Your prescription');
  assert.deepStrictEqual(C.visibleFields(rx, { ancSideEffectsYes: 'no' }).map(f => f.key).slice(-1), ['ancSideEffectsYes']);
  assert.deepStrictEqual(C.visibleFields(rx, { ancSideEffectsYes: 'yes' }).map(f => f.key).slice(-1), ['ancSideEffects']);
  // Music: no music, no music questions; otherwise the clean-versions question is asked.
  const music = C.INTAKE_SECTIONS.find(s => s.title === 'Music');
  assert.deepStrictEqual(C.visibleFields(music, {}).map(f => f.key), ['musicService', 'musicType', 'bandsMusic', 'songs', 'cleanOnly']);
  assert.deepStrictEqual(C.visibleFields(music, { musicService: 'Spotify' }).map(f => f.key), ['musicService', 'musicType', 'bandsMusic', 'songs', 'cleanOnly']);
  assert.deepStrictEqual(C.visibleFields(music, { musicService: 'I raw dog training' }).map(f => f.key), ['musicService']);
  assert.strictEqual(music.fields.find(f => f.key === 'cleanOnly').type, 'yesno');
  for (const s of C.INTAKE_SECTIONS) assert.ok(!s.example, s.title + ': the examples live in the boxes (Chris, 2026-09-23)');
  assert.ok(C.intakeFields().some(f => f.key === 'teeth'), 'brushing and flossing is asked');
  assert.match(C.INTAKE_SECTIONS.find(s => s.title === 'Music').hint, /The Brofessor can make music suggestions/);
  assert.match(C.formatIntakeForCoach('V', { testEvents: 'push-ups', testDate: '2026-11-01' }), /GOALS\nTest events: push-ups\nTest date: 2026-11-01/, 'an old test-prep answer prints under Goals');
  // The prescription screen appears only after a yes.
  assert.ok(!C.visibleSections({}).some(s => s.title === 'Your prescription'));
  assert.ok(!C.visibleSections({ ancillariesYes: 'no' }).some(s => s.title === 'Your prescription'));
  assert.ok(C.visibleSections({ ancillariesYes: 'yes' }).some(s => s.title === 'Your prescription'));
  assert.strictEqual(C.visibleSections({ ancillariesYes: 'yes' }).length, C.INTAKE_SECTIONS.length);
  assert.match(C.INTAKE_SECTIONS.find(s => s.title === 'Tools').fields[0].hint, /MyFitnessPal/);
  const keys = C.intakeFields().map(f => f.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'every key is asked once');
  // The same asks for both passes, so the two days compare field for field.
  const asks = pass => routine.find(s => s.pass === pass).fields.filter(f => f.ask && f.ask !== 'hours').map(f => f.ask);
  assert.deepStrictEqual(asks('work'), asks('off'));
  assert.deepStrictEqual(asks('work'), ['wake', 'meals', 'train', 'evening', 'bed']);
  assert.ok(keys.includes('workHours') && !keys.includes('offHours'), 'the fixed blocks belong to the work day alone');
  for (const old of ['wakeTime', 'bedTime']) assert.ok(!keys.includes(old), old + ' is never asked again');
  assert.ok(keys.includes('habitKeep') && keys.includes('habitBreak') && keys.includes('obstacle'));
  // Every field can be drawn by the app: a known type, options for a select.
  for (const f of C.intakeFields()) {
    assert.ok(['number', 'text', 'select', 'textarea', 'yesno', 'choice', 'date'].includes(f.type), f.key + ' has type ' + f.type);
    if (f.type === 'choice') assert.ok(f.options.length >= 2 && f.options.length <= 3, f.key + ': buttons for two or three options, a list beyond');
    if (f.type === 'select') assert.ok(!(f.options.length === 2 && f.options.includes('yes')), f.key + ': a yes or no is two buttons, not a drop-down');
    if (f.type === 'select') assert.ok(f.options.length > 1, f.key + ' needs options');
    assert.ok(f.label, f.key + ' needs a label');
  }
  const onScreen = C.INTAKE_SECTIONS.map(s => [s.title, s.hint || ''].concat(s.fields.map(f => f.label + ' ' + (f.hint || ''))).join(' ')).join(' ');
  assert.ok(!/nudge/i.test(onScreen), 'the word nudge is not one a client reads');
});

test('old answers are told apart from new ones, and both still print for the coach', () => {
  const v1 = { age: 40, job: 'desk', activity: 'mostly sitting', wakeTime: '05:30', workHours: '8 to 5', bedTime: '22:30', habitBreak: 'late snacks' };
  const v2 = { age: 40, job: 'desk', workWake: '5:30, coffee', workHours: '7:15, 8 to 5, 30 min', workBed: '10:30, 20 min', offWake: '8, kids' };
  assert.strictEqual(C.intakeVersionOf(v1), 1);
  assert.strictEqual(C.intakeVersionOf(v2), 2);
  assert.strictEqual(C.intakeVersionOf({}), 2, 'nothing answered is the current version');
  assert.strictEqual(C.intakeVersionOf({ job: 'desk', workHours: '8 to 5' }), 2, 'the shared keys alone do not make it old');
  const oldText = C.formatIntakeForCoach('Vince', { ...v1, ancillaries: 'semaglutide 0.5 mg Sundays' });
  assert.match(oldText, /HEALTH\nAnything prescribed: semaglutide 0.5 mg Sundays/, 'the old prescription answer prints under Health');
  assert.match(oldText, /^INTAKE: Vince/);
  assert.match(oldText, /YOUR DAY\nWhat do you do all day\?: desk\nHow active is that\?: mostly sitting\nUsual wake time: 05:30\nWork hours: 8 to 5\nUsual bed time: 22:30/);
  assert.ok(!/YOUR WORK DAY|YOUR DAY OFF/.test(oldText), 'old answers do not print empty new sections');
  const newText = C.formatIntakeForCoach('Vince', v2);
  assert.match(newText, /YOUR WORK DAY\nWhat do you do all day\?: desk\nWake time, and the first thing you do: 5:30, coffee\nLeave for work, work start and end, commute: 7:15, 8 to 5, 30 min/);
  assert.match(newText, /YOUR DAY OFF\nWake time, and the first thing you do: 8, kids/);
  assert.ok(!/YOUR DAY\n/.test(newText));
  assert.match(C.formatIntakeForCoach('', { workMeals: 'a\nb\n\nc' }), /where: a; b; c/, 'newlines in an answer become one line');
});

test('routineBaseline reads either version into one shape, blank as empty strings', () => {
  const b1 = C.routineBaseline({ job: 'desk', wakeTime: ' 05:30 ', workHours: '8 to 5', bedTime: '22:30' });
  assert.strictEqual(b1.version, 1);
  assert.deepStrictEqual(b1.work, { wake: '05:30', hours: '8 to 5', meals: '', train: '', evening: '', bed: '22:30' });
  assert.strictEqual(b1.off.wake, '');
  assert.strictEqual(b1.empty, false);
  const b2 = C.routineBaseline({ workWake: '6, coffee', wakeTime: '5', offBed: 'midnight', steps: 6000, habitKeep: 'walks' });
  assert.strictEqual(b2.version, 2);
  assert.strictEqual(b2.work.wake, '6, coffee', 'a new answer wins over an old one');
  assert.strictEqual(b2.off.bed, 'midnight');
  assert.strictEqual(b2.most.steps, '6000', 'numbers come back as strings');
  assert.strictEqual(b2.habitKeep, 'walks');
  assert.strictEqual(C.routineBaseline({ age: 40, habitKeep: 'walks' }).empty, true, 'goals alone are not a routine');
  assert.strictEqual(C.routineBaseline(null).empty, true);
  assert.deepStrictEqual(Object.keys(C.routineBaseline({}).work), ['wake', 'hours', 'meals', 'train', 'evening', 'bed']);
});

test('routineChanges names what moved between two baselines, routine fields only', () => {
  const before = { workWake: '5:30', offBed: '', steps: '5000', age: 40, shortGoals: 'x' };
  const after = { workWake: '6, coffee', offBed: '11', steps: '5000', age: 41, shortGoals: 'y' };
  const ch = C.routineChanges(before, after);
  assert.deepStrictEqual(ch.map(c => c.key), ['workWake', 'offBed']);
  assert.deepStrictEqual(ch[0], { key: 'workWake', label: 'Your work day: Wake time, and the first thing you do', from: '5:30', to: '6, coffee' });
  assert.deepStrictEqual(C.routineChanges(after, after), []);
  assert.deepStrictEqual(C.routineChanges(null, {}), []);
  assert.strictEqual(C.routineChanges({ workWake: '6' }, { workWake: ' 6 ' }).length, 0, 'whitespace is not a change');
  // An old-shape first answer against a new-shape re-answer with the same
  // times is no change; a moved time still is.
  const v1 = { wakeTime: '5:30', workHours: '8 to 5', bedTime: '10:30', job: 'desk' };
  assert.deepStrictEqual(C.routineChanges(v1, { workWake: '5:30', workHours: '8 to 5', workBed: '10:30', job: 'desk' }), []);
  assert.deepStrictEqual(C.routineChanges(v1, { workWake: '5:30', workHours: '8 to 5', workBed: '9:45', job: 'desk' }).map(c => c.key + ':' + c.from + '>' + c.to), ['workBed:10:30>9:45']);
});

test('timeFromText reads the clock time people actually type', () => {
  const t = (text, opts) => C.timeFromText(text, opts);
  assert.strictEqual(t('5:30, coffee and my phone'), 5 * 60 + 30);
  assert.strictEqual(t('6pm'), 18 * 60);
  assert.strictEqual(t('6 PM'), 18 * 60);
  assert.strictEqual(t('17:30'), 17 * 60 + 30);
  assert.strictEqual(t('10.30pm, 20 minutes'), 22 * 60 + 30);
  assert.strictEqual(t('12 am'), 0);
  assert.strictEqual(t('12 pm'), 12 * 60);
  assert.strictEqual(t('noon at my desk'), 12 * 60);
  assert.strictEqual(t('midnight'), 0);
  assert.strictEqual(t('7:15, 8 to 5, 30 minutes each way'), 7 * 60 + 15, 'the first time on the line');
  // A bare hour: morning by default, evening when the field is an evening one.
  assert.strictEqual(t('6'), 6 * 60);
  assert.strictEqual(t('about 6', { pm: true }), 18 * 60);
  assert.strictEqual(t('10 phone in bed', { pm: true }), 22 * 60);
  assert.strictEqual(t('11:30, 20 minutes', { pm: true }), 23 * 60 + 30);
  assert.strictEqual(t('12', { pm: true }), 0, 'twelve at bed time is midnight');
  assert.strictEqual(t('12'), 12 * 60, 'twelve in the day is noon');
  assert.strictEqual(t('6 am', { pm: true }), 6 * 60, 'am said is am');
  // A bare number that cannot be a clock hour is not one.
  assert.strictEqual(t('about 20 minutes to drop off, lights out 10:30', { pm: true }), 22 * 60 + 30);
  assert.strictEqual(t('17'), null);
  assert.strictEqual(t('30 minutes each way'), null);
  assert.strictEqual(t('2 kids up, then 6'), 2 * 60, 'a small bare number is still read as an hour');
  for (const none of ['', null, 'after work', 'whenever', '25:00', '9:75', '0']) assert.strictEqual(t(none), null, JSON.stringify(none));
});

test('mergeIntakeAnswers layers every submission, newest winning, blanks never overwriting', () => {
  const rows = [
    { answers: { workWake: '6, coffee', workBed: '' } },                       // the re-answer, routine only
    { answers: { workWake: '5:30', workBed: '10:30', habitBreak: 'late snacks', age: '40' } }
  ];
  assert.deepStrictEqual(C.mergeIntakeAnswers(rows), { workWake: '6, coffee', workBed: '10:30', habitBreak: 'late snacks', age: '40' });
  assert.deepStrictEqual(C.mergeIntakeAnswers([]), {});
  assert.deepStrictEqual(C.mergeIntakeAnswers(null), {});
  assert.deepStrictEqual(C.mergeIntakeAnswers([{ answers: null }, { answers: { a: 1 } }]), { a: 1 });
});

test('one goal list: each goal takes the term its own time frame says, and the old two lists still read', () => {
  const g = C.goalsFromIntake({ goals: ['Lose 10 lb before vacation in 3 months', 'Walk every morning', 'Deadlift my body weight by spring',
    'Drop 4 lb in 4 weeks', 'Run a 5k next year', ''].join('\n') });
  assert.deepStrictEqual(g.map(x => x.text + ':' + x.term), [
    'Lose 10 lb before vacation in 3 months:long', 'Walk every morning:short', 'Deadlift my body weight by spring:long',
    'Drop 4 lb in 4 weeks:short', 'Run a 5k next year:long']);
  // The plausible traps: a bare season or month word, a hyphen, a long run of weeks.
  const term = t => C.goalsFromIntake({ goals: t })[0].term;
  assert.strictEqual(term('Fall asleep faster'), 'short');
  assert.strictEqual(term('I may finally run a 5k'), 'short');
  assert.strictEqual(term('Lose 10 lb in a 3-month push'), 'long');
  assert.strictEqual(term('Drop 8 lb in 8 weeks'), 'long');
  assert.strictEqual(term('Be under 190 by May'), 'long');
  assert.strictEqual(term('Bench 225 this summer'), 'long');
  assert.strictEqual(term('Two years from now, a marathon'), 'long');
  const old = C.goalsFromIntake({ shortGoals: 'Drop 6 lb', longGoals: '185 by spring' });
  assert.deepStrictEqual(old.map(x => x.term), ['short', 'long']);
  assert.deepStrictEqual(C.goalsFromIntake({}), []);
  assert.ok(!C.intakeFields().some(f => f.key === 'shortGoals' || f.key === 'longGoals'), 'the two lists are not asked');
  assert.match(C.formatIntakeForCoach('V', { shortGoals: 'Drop 6 lb' }), /GOALS\nNext 4 weeks: Drop 6 lb/, 'an old answer still prints');
  assert.match(C.INTAKE_SECTIONS[1].hint, /time frame/);
  assert.strictEqual(C.INTAKE_SECTIONS[1].lead, 'A goal without a plan is just a wish.');
  assert.ok(!C.intakeFields().some(f => f.key === 'bulkStyle'), 'the bulking question is gone');
  assert.strictEqual(C.intakeFields().find(f => f.key === 'habitKeep').label, 'What do you like most about your day?');
  assert.strictEqual(C.intakeFields().find(f => f.key === 'habitBreak').label, 'What do you like least about your day?');
});

test('answers hidden by a No never print, never reach the baseline, and drop at send', () => {
  const a = { ancillariesYes: 'no', ancName: 'Semaglutide', ancDose: '0.5 mg', musicService: 'I raw dog training', songs: 'Enter Sandman',
              foodAppYes: 'no', foodApp: 'MyFitnessPal', workWake: '6', habitBreak: 'late snacks', wakeTime: '5:30' };
  const kept = C.visibleAnswers(a);
  assert.deepStrictEqual(Object.keys(kept).sort(), ['ancillariesYes', 'foodAppYes', 'habitBreak', 'musicService', 'wakeTime', 'workWake']);
  const text = C.formatIntakeForCoach('V', a);
  assert.ok(!/Semaglutide|MyFitnessPal|Enter Sandman/.test(text), 'nothing the client hid prints');
  assert.match(text, /Are you on anything prescribed\?: no/);
  const yes = C.formatIntakeForCoach('V', { ...a, ancillariesYes: 'yes' });
  assert.match(yes, /YOUR PRESCRIPTION\nWhat is it\?: Semaglutide/, 'a yes shows it again');
  assert.deepStrictEqual(C.YESNO, ['yes', 'no']);
  // A version-1 bed time prints when the re-answer left the new slot blank, and not when it did not.
  assert.match(C.formatIntakeForCoach('V', { workWake: '6', bedTime: '10' }), /Usual bed time: 10/);
  assert.ok(!/Usual bed time/.test(C.formatIntakeForCoach('V', { workWake: '6', workBed: '10:30', bedTime: '10' })));
  assert.strictEqual(C.routineBaseline({ workWake: '6', bedTime: '10' }).work.bed, '10');
});

test('the word nudge is never on a client screen, anywhere in the app', () => {
  // The code keeps "nudge" as a field name; the client reads "reminder".
  const html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
  // Every single-quoted string literal; the ones starting with a capital are sentences the client reads.
  const strings = [...html.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  const shown = strings.filter(s => /\bnudges?\b/i.test(s) && /^[A-Z]/.test(s));
  assert.deepStrictEqual(shown, [], 'client-facing text with the word nudge');
});

test('checklistChanged sees an item added, removed or moved, and not a note edit', () => {
  const items = [{ id: 'a', dueBy: '07:00', notes: 'x' }, { id: 'b', dueBy: '' }];
  assert.strictEqual(C.ROUTINE_AGAIN_DAYS, 14);
  assert.strictEqual(C.checklistChanged(items, items.map(i => ({ ...i, notes: 'edited' }))), false);
  assert.strictEqual(C.checklistChanged(items, items.slice().reverse()), false, 'order is not a change');
  assert.strictEqual(C.checklistChanged(items, items.concat([{ id: 'c' }])), true);
  assert.strictEqual(C.checklistChanged(items, items.slice(0, 1)), true);
  assert.strictEqual(C.checklistChanged(items, [{ id: 'a', dueBy: '06:30' }, { id: 'b' }]), true, 'a due-by moved');
  assert.strictEqual(C.checklistChanged([], []), false);
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

// ── coach consents (learning plan D9, section 4) ───────────────────────────

test('the consent wording is exactly what Chris approved', () => {
  // Chris, 2026-09-22: the welcome screen carries the disclosure and every
  // consent as a two-button question; the chat opens with a reminder.
  const c1 = C.CONSENTS[1], c2 = C.CONSENTS[2], w = C.WELCOME;
  assert.strictEqual(c1.version, 'c1-2026-09-22');
  assert.strictEqual(c1.paragraphs.join(' '), 'The Brofessor is AI, not a person. Chats with him are saved and a human coach can read them. Anything he flags gets reviewed by a real person.');
  assert.strictEqual(c1.yes, 'I’m in');
  assert.strictEqual(c2.version, 'c2-2026-09-22');
  assert.strictEqual(c2.title, 'Help The Brofessor learn?');
  assert.strictEqual(c2.yes, 'Yes, use my chats');
  assert.strictEqual(c2.no, 'No thanks');
  assert.strictEqual(w.version, 'w3-2026-09-23');   // w2: the nudge question reworded, 2026-09-22; w3: the intro cut, 2026-09-23
  assert.strictEqual(w.title, 'Welcome to Beast Mode');
  assert.strictEqual(w.tagline, 'Unleash the Beast, one habit at a time');
  assert.strictEqual(w.features.length, 4);
  assert.strictEqual(w.features[2].text, 'Follow your plan and earn points. Keep crushing and a streak grows. Can you earn the right to be the Chief Brologist?!');
  assert.deepStrictEqual([w.questions.share.yes, w.questions.share.no], ['Yes, share it', 'Keep it on my phone']);
  assert.strictEqual(w.questions.nudges.title, 'Do you want to hear from The Brofessor?');
  assert.deepStrictEqual([w.questions.nudges.yes, w.questions.nudges.no], ['Yes, hit me up', 'No thanks']);
  // The word "nudge" is a field name in the code and never on the screen.
  const onScreen = [w.title, w.tagline, w.intro, w.heading, w.button, w.note]
    .concat(w.features.map(f => f.title + ' ' + f.text))
    .concat(Object.keys(w.questions).map(k => [w.questions[k].title, w.questions[k].text, w.questions[k].yes, w.questions[k].no].join(' ')))
    .join(' ');
  assert.ok(!/nudge/i.test(onScreen), 'the word nudge is not one a client reads');
  assert.match(C.COACH_OPENER.learning, /^Welcome to coaching\. I’m The Brofessor, your guide to SHREDZVILLE\./);
  assert.match(C.COACH_OPENER.learning, /You’re letting me learn from them so I can coach you better\. You can change your choices in Profile, any time\./);
  assert.match(C.COACH_OPENER.notLearning, /You’ve kept them out of my training, which is fine by me\. You can change your choices in Profile, any time\./);
  for (const t of [C.COACH_OPENER.learning, C.COACH_OPENER.notLearning]) {
    assert.match(t, /call or text 988/, 'the crisis line lives in the chat');
    assert.match(t, /Now, what are we working on\?$/);
  }
  assert.ok(!/988/.test(JSON.stringify(w)), 'and not on the welcome screen');
});

test('consent versions fit what the coach server will store', () => {
  // brofessor-coach/src/index.js, CONSENT_VERSION.
  [1, 2].forEach(k => assert.match(C.CONSENTS[k].version, /^[A-Za-z0-9._-]{1,40}$/));
  assert.notStrictEqual(C.CONSENTS[1].version, C.CONSENTS[2].version);
});

test('a consent stands only for the current wording', () => {
  const v1 = C.CONSENTS[1].version, v2 = C.CONSENTS[2].version;
  assert.strictEqual(C.consentStands(1, { version: v1, answer: 'yes' }), true);
  assert.strictEqual(C.consentStands(1, null), false);
  assert.strictEqual(C.consentStands(1, undefined), false);
  assert.strictEqual(C.consentStands(1, { version: 'c1-old', answer: 'yes' }), false, 'new wording means asking again');
  assert.strictEqual(C.consentStands(1, { version: v1, answer: 'no' }), false, 'consent 1 has no "no"');
  // Consent 2 is answered either way; "no" is an answer, not a gap.
  assert.strictEqual(C.consentStands(2, { version: v2, answer: 'no' }), true);
  assert.strictEqual(C.consentStands(2, { version: v2, answer: 'yes' }), true);
  assert.strictEqual(C.consentStands(2, { version: v2, answer: 'maybe' }), false);
  assert.strictEqual(C.consentStands(3, { version: v2, answer: 'yes' }), false);
});


// ── the daily status (routine change loop brief, 3a) ──────────────────────

function statusState(over) {
  const items = [item({ id: 'c1', name: 'Zone 2', core: true }), item({ id: 'h1', name: 'Water', kind: 'habit', core: false })];
  const log = {};
  // Two closed days, then yesterday closed, today half done.
  for (const d of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    log[C.logKey('c1', d)] = { done: true, completedAt: at(d, 8, 0) };
    log[C.logKey('h1', d)] = { done: true, completedAt: at(d, 9, 0) };
  }
  log[C.logKey('h1', '2026-09-21')] = { done: true, completedAt: at('2026-09-21', 9, 0) };
  return Object.assign({ items, log, perfectWeek: C.perfectWeek(items), earnedLevel: 1 }, over);
}

test('statusPayload carries the numbers on the client screen and nothing else', () => {
  const st = statusState();
  const p = C.statusPayload(st, { today: '2026-09-21', tz: 'America/Los_Angeles', pushId: 'rem1' });
  assert.strictEqual(p.v, C.STATUS_VERSION);
  assert.strictEqual(p.date, '2026-09-21');
  assert.strictEqual(p.tz, 'America/Los_Angeles');
  assert.strictEqual(p.streak, 3, 'closed days before today');
  assert.strictEqual(p.bestStreak, 3);
  assert.strictEqual(p.scheduled, 2);
  assert.strictEqual(p.done, 1);
  assert.strictEqual(p.scheduledCore, 1);
  assert.strictEqual(p.doneCore, 0);
  assert.strictEqual(p.gate, C.GATES.broken, 'today is provisional: core not yet done reads broken');
  assert.strictEqual(p.dayPoints, C.dayResult(st.items, st.log, '2026-09-21').points, 'today\'s own points, beside the running total');
  assert.deepStrictEqual(p.yesterday, { date: '2026-09-20', gate: 'closed', done: 2, scheduled: 2, points: C.dayResult(st.items, st.log, '2026-09-20').points });
  assert.strictEqual(p.startDate, '2026-09-01');
  assert.strictEqual(p.day, 21);
  assert.strictEqual(p.pushId, 'rem1');
  assert.strictEqual(p.sharing, true);
  assert.strictEqual(p.nudges, null, 'unanswered until the welcome screen');
  assert.strictEqual(C.statusPayload(st, { today: '2026-09-21', nudges: false }).nudges, false);
  assert.strictEqual(C.validateStatus({ ...p, nudges: true }).status.nudges, true);
  assert.strictEqual(C.validateStatus({ ...p, nudges: 'yes' }).status.nudges, null, 'anything but a boolean is unanswered');
  assert.strictEqual(typeof p.rank, 'string');
  assert.ok(p.points > 0);
  for (const k of Object.keys(p)) assert.ok(!/items|log|notes|name|goals/.test(k), 'no ' + k);
  assert.strictEqual(C.statusPayload(st, { today: '2026-09-21', sharing: false }).sharing, false);
});

test('a status round-trips through validateStatus, and anything off-vocabulary is refused', () => {
  const p = C.statusPayload(statusState(), { today: '2026-09-21', tz: 'Europe/London' });
  const ok = C.validateStatus(JSON.parse(JSON.stringify(p)));
  assert.strictEqual(ok.ok, true, ok.error);
  assert.strictEqual(ok.status.gate, p.gate);
  assert.strictEqual(ok.status.tz, 'Europe/London');
  assert.deepStrictEqual(ok.status.yesterday, p.yesterday);
  for (const [bad, why] of [
    [{ ...p, gate: 'open' }, 'gate not in the vocabulary'],
    [{ ...p, date: '9/21' }, 'bad date'],
    [{ ...p, tz: 'not a zone!' }, 'bad zone'],
    [{ ...p, streak: -1 }, 'negative'],
    [{ ...p, streak: 2.5 }, 'fraction'],
    [{ ...p, points: 'lots' }, 'text'],
    [{ ...p, yesterday: { date: 'x', gate: 'closed' } }, 'bad yesterday'],
    [{ ...p, v: C.STATUS_VERSION + 1 }, 'newer version'],
    [null, 'nothing']
  ]) assert.ok(C.validateStatus(bad).error, why);
  assert.ok(C.validateStatus({ ...p, rank: 'Grand Poobah' }).error, 'a rank is one of the level names');
  assert.ok(C.validateStatus({ ...p, level: 9 }).error, 'a level is one of the levels');
  assert.ok(C.validateStatus({ ...p, streak: 3661 }).error, 'ten years is the ceiling');
  assert.ok(C.validateStatus({ ...p, streak: 30 }).error, 'a streak cannot outrun the program');
  assert.ok(C.validateStatus({ ...p, done: 3, scheduled: 2 }).error, 'done within scheduled');
  assert.ok(C.validateStatus({ ...p, yesterday: { date: '2026-09-19', gate: 'closed', done: 1, scheduled: 1, points: 1 } }).error, 'yesterday is the day before');
  assert.ok(C.validateStatus({ ...p, yesterday: { date: '2026-09-20', gate: 'closed', done: 1.5, scheduled: 1, points: 1 } }).error, 'yesterday counts are whole');
  assert.ok(C.validateStatus({ ...p, yesterday: { date: '2026-09-20', gate: 'closed', done: 1, scheduled: 1, points: 1e300 } }).error, 'yesterday points bounded');
  // With a clock, the date must be today or a day either side in the claimed zone.
  const now = new Date('2026-09-22T02:00:00Z');   // 7 p.m. on the 21st in Los Angeles
  assert.strictEqual(C.validateStatus(p, { now }).ok, true);
  assert.strictEqual(C.validateStatus({ ...p, date: '2026-09-22', yesterday: null }, { now }).ok, true, 'a day ahead is fine (UTC phones)');
  assert.ok(C.validateStatus({ ...p, date: '2026-09-19', yesterday: null }, { now }).error, 'two days back is not');
  assert.ok(C.validateStatus({ ...p, date: '2099-12-31', yesterday: null }, { now }).error, 'the future is not');
  assert.ok(C.validateStatus({ ...p, tz: 'Mars/Olympus' }).error, 'an unknown zone is refused');
  assert.strictEqual(C.todayIn('America/Los_Angeles', now), '2026-09-21');
  assert.strictEqual(C.todayIn('Asia/Tokyo', now), '2026-09-22');
  assert.strictEqual(C.validateStatus({ ...p, pushId: 'a|b', extra: 'dropped' }).status.pushId, null, 'a bad push id is dropped, not fatal');
  assert.strictEqual(C.validateStatus({ ...p, sharing: false }).status.sharing, false);
});

test('GATES is the vocabulary dayResult speaks', () => {
  assert.deepStrictEqual(Object.keys(C.GATES).sort(), ['broken', 'closed', 'neutral']);
  const st = statusState();
  assert.strictEqual(C.dayResult(st.items, st.log, '2026-09-20').gate, C.GATES.closed);
  assert.strictEqual(C.dayResult([item({ core: false })], {}, '2026-09-20').gate, C.GATES.neutral);
});
