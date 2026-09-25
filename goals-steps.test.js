/* Tests for goals with steps and finding the time (goals brief, draft 3,
   sections 4a, 4i, 4k and 4l). Run with: node --test */

const test = require('node:test');
const assert = require('node:assert');
const C = require('./beast-core.js');

const P = '2026-09-28';                       // plan start, a Monday
const day = n => C.addDays(P, n);

function at(ymd, hh, mm) {
  const p = ymd.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), hh, mm, 0).toISOString();
}

function item(over) {
  return C.normalizeItem(Object.assign({ id: 'x1', name: 'Zone 2', kind: 'habit', freq: 'daily', core: true, addedAt: P }, over));
}

function tick(log, it, ymd, hh, mm) {
  log[C.logKey(it.id, ymd)] = { done: true, completedAt: at(ymd, hh, mm), values: {} };
}

// ── the item model ─────────────────────────────────────────────────────────

test('an item carries swap, block, replaces and moving-target steps, and old items get the defaults', () => {
  const old = item({});
  assert.strictEqual(old.swap, 0);
  assert.strictEqual(old.block, 1);
  assert.strictEqual(old.replaces, '');
  assert.deepStrictEqual(old.steps, []);
  const it = item({ swap: 3, block: 2, replaces: '  30 min of TV. ', dueBy: '22:30',
    steps: [{ swap: 4, dueBy: '22:00', label: 'Lights out 10:00 pm' }, { swap: 0, dueBy: '21:00' }, { swap: 2, dueBy: 'late' }] });
  assert.strictEqual(it.swap, 3);
  assert.strictEqual(it.block, 2);
  assert.strictEqual(it.replaces, '30 min of TV.');
  assert.deepStrictEqual(it.steps, [{ swap: 4, dueBy: '22:00', label: 'Lights out 10:00 pm', at: '' }], 'bad steps are dropped');
});

// ── swap dates (4k.1, 4l.1, 4l.2) ─────────────────────────────────────────

test('startWeekFor turns a swap number and a pace into a week of the block', () => {
  const weeks = pace => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => C.startWeekFor(n, pace));
  assert.deepStrictEqual(weeks('standard'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepStrictEqual(weeks('slower'), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepStrictEqual(weeks('faster'), [1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.deepStrictEqual(weeks('nonsense'), weeks('standard'), 'an unknown pace is standard');
});

test('each pace dates swaps from the block start, and block 2 starts on day 29', () => {
  const items = [1, 2, 3, 4].map(n => item({ id: 's' + n, swap: n }));
  const dates = pace => C.scheduleSwaps(items, { planStart: P, today: P, pace }).map(i => i.addedAt);
  assert.deepStrictEqual(dates('standard'), [P, day(7), day(14), day(21)]);
  assert.deepStrictEqual(dates('faster'), [P, P, day(7), day(7)]);
  assert.deepStrictEqual(dates('slower'), [P, day(14), day(28), day(42)]);
  // Block 2's swaps count from its own first week, whatever block 1 did.
  const b2 = [1, 2].map(n => item({ id: 't' + n, swap: n, block: 2 }));
  for (const pace of C.PACES) {
    const out = C.scheduleSwaps(b2, { planStart: P, today: day(28), pace });
    assert.strictEqual(out[0].addedAt, day(28), pace + ': block 2 swap 1 is day 29');
  }
});

test('a swap is never dated before today: a late block 2 draft never reopens a closed day', () => {
  const b2 = [item({ id: 't1', swap: 1, block: 2 }), item({ id: 't2', swap: 2, block: 2 })];
  const late = C.scheduleSwaps(b2, { planStart: P, today: day(31), pace: 'standard' });
  assert.strictEqual(late[0].addedAt, day(31), 'swap 1 would have been day 29');
  assert.strictEqual(late[1].addedAt, day(35));
  const faster = C.scheduleSwaps([item({ id: 'f', swap: 2, block: 1 })], { planStart: P, today: day(3), pace: 'faster' });
  assert.strictEqual(faster[0].addedAt, day(3));
});

test('a pace change moves only swaps still to come; one already started keeps its date', () => {
  const items = [1, 2, 3].map(n => item({ id: 's' + n, swap: n }));
  const first = C.scheduleSwaps(items, { planStart: P, today: P, pace: 'standard' });
  // Week 2 is under way (day 9), swap 3 is still in week 3.
  const slower = C.scheduleSwaps(first, { planStart: P, today: day(9), pace: 'slower', prev: first });
  assert.strictEqual(slower[0].addedAt, P);
  assert.strictEqual(slower[1].addedAt, day(7), 'started: frozen');
  assert.strictEqual(slower[2].addedAt, day(28), 'swap 3 at slower is week 5');
  // A plan update that re-sends a started swap keeps its date.
  const again = C.scheduleSwaps(items, { planStart: P, today: day(9), pace: 'standard', prev: slower });
  assert.strictEqual(again[1].addedAt, day(7));
  assert.strictEqual(again[2].addedAt, day(14));
});

test('the date on the wire is ignored for a swap: the phone dates it', () => {
  const wire = [item({ id: 's2', swap: 2, addedAt: '2026-01-01' })];
  assert.strictEqual(C.scheduleSwaps(wire, { planStart: P, today: P })[0].addedAt, day(7));
});

// ── moving targets (4k.3, 4l.2, 4l.3) ─────────────────────────────────────

function lightsOut() {
  return item({ id: 'lo', name: 'Lights out', dueBy: '22:30', core: false,
    steps: [{ swap: 2, dueBy: '22:00' }, { swap: 3, dueBy: '21:30' }] });
}

test('dueByOn gives the time in force on each day, and steps are dated like swaps', () => {
  const [it] = C.scheduleSwaps([lightsOut()], { planStart: P, today: P });
  assert.deepStrictEqual(it.steps.map(s => s.at), [day(7), day(14)]);
  assert.strictEqual(C.dueByOn(it, P), '22:30');
  assert.strictEqual(C.dueByOn(it, day(6)), '22:30');
  assert.strictEqual(C.dueByOn(it, day(7)), '22:00');
  assert.strictEqual(C.dueByOn(it, day(20)), '21:30');
  assert.strictEqual(C.dueByOn(item({ dueBy: '08:00' }), P), '08:00', 'no steps: its own time');
});

test('a target moving earlier never turns a past on-time tick late, so points never drop', () => {
  const [it] = C.scheduleSwaps([lightsOut()], { planStart: P, today: P });
  const log = {};
  tick(log, it, day(2), 22, 15);              // on time against 10:30 pm
  tick(log, it, day(8), 22, 15);              // late against 10:00 pm
  const e2 = C.entryFor(log, 'lo', day(2)), e8 = C.entryFor(log, 'lo', day(8));
  assert.strictEqual(C.isOnTime(it, e2, day(2)), true);
  assert.strictEqual(C.isOnTime(it, e8, day(8)), false);
  const before = C.totalPoints([it], log, day(8));
  // A pace change later re-dates nothing that has started.
  const [slow] = C.scheduleSwaps([it], { planStart: P, today: day(9), pace: 'slower', prev: [it] });
  assert.strictEqual(slow.steps[0].at, day(7), 'the step under way is frozen');
  assert.strictEqual(slow.steps[1].at, day(28), 'the one to come moves');
  assert.strictEqual(C.totalPoints([slow], log, day(8)), before);
});

test('reminders: every step time is a slot, and each day reminds at the time in force', () => {
  const [it] = C.scheduleSwaps([lightsOut()], { planStart: P, today: P });
  assert.deepStrictEqual(C.reminderSlots([it]), ['21:30', '22:00', '22:30']);
  assert.deepStrictEqual(C.dueAtSlot([it], {}, day(1), '22:30').map(i => i.id), ['lo']);
  assert.deepStrictEqual(C.dueAtSlot([it], {}, day(1), '22:00'), []);
  assert.deepStrictEqual(C.dueAtSlot([it], {}, day(8), '22:00').map(i => i.id), ['lo']);
  assert.deepStrictEqual(C.dueAtSlot([it], {}, day(8), '22:30'), []);
});

test('checklistChanged reads the time in force: a step starting later is not a change today', () => {
  const plain = item({ id: 'lo', name: 'Lights out', dueBy: '22:30' });
  const [moving] = C.scheduleSwaps([lightsOut()], { planStart: P, today: P });
  assert.strictEqual(C.checklistChanged([plain], [moving], P), false);
  assert.strictEqual(C.checklistChanged([plain], [moving], day(7)), true);
});

// ── goals (4a, 4k.4) ──────────────────────────────────────────────────────

const weightGoal = () => ({
  key: 'weight', text: '205 lbs by March', term: 'long', why: 'Bigger and stronger at 50.',
  measure: { kind: 'weight', start: 190, target: 205, by: '2027-03-31' },
  months: [192.5, 195, 197.5, 200, 202.5, 205].map((t, i) => ({ n: i + 1, target: t, text: t + ' lbs' })),
  weeks: [190.5, 191, 191.8, 192.5].map((t, i) => ({ n: i + 1, target: t, text: 'Average ' + t + ' lbs' }))
});

test('a goal without a measure keeps exactly the shape it always had', () => {
  const [g] = C.normalizeGoals([{ id: 'g1', text: 'Squat 315', term: 'long', completed: true }]);
  assert.deepStrictEqual(Object.keys(g).sort(), ['completed', 'id', 'term', 'text']);
});

test('a goal with steps keeps its key, why, measure, months and weeks', () => {
  const [g] = C.normalizeGoals([Object.assign(weightGoal(), { key: ' Weight ' })]);
  assert.strictEqual(g.key, 'weight');
  assert.strictEqual(g.why, 'Bigger and stronger at 50.');
  assert.deepStrictEqual(g.measure, { kind: 'weight', by: '2027-03-31', start: 190, target: 205 });
  assert.strictEqual(g.months.length, 6);
  assert.strictEqual(g.weeks[2].target, 191.8);
  assert.strictEqual(g.block, 1);
  const [h] = C.normalizeGoals([{ key: 'sleep', text: 'Sleep 7 hours', measure: { kind: 'habit', by: '2026-12-01' },
    weeks: [{ swap: 2, target: 4 }, { swap: 'x', target: 3 }], months: [{ n: 1, target: 6 }] }]);
  assert.deepStrictEqual(h.weeks, [{ swap: 2, target: 4, text: '' }], 'a habit step is keyed by swap');
});

test('mergeGoals keeps a goal’s id, completion and agreement by key, and says which cards changed', () => {
  const [prev] = C.normalizeGoals([Object.assign(weightGoal(), { id: 'gW', completed: true, agreedAt: '2026-09-28T08:00:00Z' })]);
  const legacy = C.normalizeGoals([{ id: 'gL', text: 'Face looks younger at 50' }])[0];
  const same = C.mergeGoals([prev, legacy], [weightGoal(), { text: 'Face looks younger at 50' }]);
  assert.strictEqual(same.goals[0].id, 'gW');
  assert.strictEqual(same.goals[0].completed, true);
  assert.strictEqual(same.goals[0].agreedAt, '2026-09-28T08:00:00Z');
  assert.strictEqual(same.goals[1].id, 'gL', 'a goal without a key matches by its words');
  assert.deepStrictEqual(same.changed, []);
  const moved = weightGoal(); moved.weeks[0].target = 190.4;
  const out = C.mergeGoals([prev], [moved, { key: 'sleep', text: 'Sleep 7 hours' }]);
  assert.deepStrictEqual(out.changed, ['gW']);
  assert.strictEqual(out.goals[0].agreedAt, undefined, 'a changed card is agreed again');
  assert.deepStrictEqual(out.added, ['Sleep 7 hours']);
});

// ── judging steps (4e, 4k.9, 4l.6, 4l.8) ──────────────────────────────────

function agreed(over) {
  return Object.assign({ goalsAgreedAt: at(P, 8, 0), profile: { startDate: P }, perfectWeek: 2380,
    items: [], goals: [], log: {}, weightLog: {}, measureLog: {}, stepLog: {}, stepAnswers: {} }, over);
}

test('a weight week is judged on its average, with the 0.3 lb margin, once it has ended', () => {
  const g = C.normalizeGoals([Object.assign(weightGoal(), { id: 'gW' })])[0];
  const wl = {};
  for (let d = 0; d < 7; d++) wl[day(d)] = 190.6;           // week 1: 190.6 against 190.5
  for (let d = 7; d < 14; d++) wl[day(d)] = 190.6;          // week 2: 190.6 against 191
  for (let d = 14; d < 21; d++) wl[day(d)] = 191.6;         // week 3: 191.6 against 191.8, inside 0.3
  const st = agreed({ goals: [g], weightLog: wl, items: [item({ goalId: 'weight' })] });
  assert.deepStrictEqual(C.judgeSteps(st, day(6)), [], 'nothing until a week has ended');
  const out = C.judgeSteps(st, day(28));
  const by = Object.fromEntries(out.map(r => [r.key, r]));
  assert.strictEqual(by['gW|1|w|1'].result, 'hit');
  assert.strictEqual(by['gW|1|w|1'].points, 340, 'a week is one perfect day');
  assert.strictEqual(by['gW|1|w|2'].result, 'missed');
  assert.strictEqual(by['gW|1|w|2'].points, 0);
  assert.strictEqual(by['gW|1|w|3'].result, 'hit');
  assert.strictEqual(by['gW|1|w|4'].result, 'missed', 'no weigh-ins is a miss');
  assert.strictEqual(by['gW|0|m|1'].result, 'missed', 'the month is its last week');
  assert.deepStrictEqual(out.map(r => r.end), out.map(r => r.end).slice().sort(), 'oldest first');
  // Written once: nothing already in the log comes back.
  const log = Object.fromEntries(out.map(r => [r.key, r]));
  assert.deepStrictEqual(C.judgeSteps(Object.assign({}, st, { stepLog: log }), day(40)).map(r => r.key), []);
});

test('a lost weight goal is judged the other way, and a month pays one perfect week', () => {
  const g = C.normalizeGoals([{ id: 'gC', key: 'cut', text: '185 by March', measure: { kind: 'weight', start: 200, target: 185, by: '2027-03-31' },
    months: [{ n: 1, target: 197 }], weeks: [{ n: 1, target: 199.5 }] }])[0];
  const wl = {};
  for (let d = 0; d < 7; d++) wl[day(d)] = 199.8;           // inside the margin going down
  for (let d = 21; d < 28; d++) wl[day(d)] = 196.5;
  const out = C.judgeSteps(agreed({ goals: [g], weightLog: wl }), day(28));
  const by = Object.fromEntries(out.map(r => [r.key, r]));
  assert.strictEqual(by['gC|1|w|1'].result, 'hit');
  assert.strictEqual(by['gC|0|m|1'].result, 'hit');
  assert.strictEqual(by['gC|0|m|1'].points, 2380);
});

test('a tape, a scale or a pair of jeans not checked that week is skipped, not missed', () => {
  const waist = C.normalizeGoals([{ id: 'gA', key: 'waist', text: 'Waist 34', measure: { kind: 'waist', start: 35, target: 34, by: '2027-01-01' },
    months: [{ n: 1, target: 34.5 }], weeks: [{ n: 1, target: 34.9 }, { n: 2, target: 34.8 }] }])[0];
  const jeans = C.normalizeGoals([{ id: 'gJ', key: 'jeans', text: 'My jeans fit again', measure: { kind: 'fit', item: 'jeans', target: 'looser', by: '2027-01-01' },
    months: [{ n: 1, target: 'looser' }] }])[0];
  const st = agreed({ goals: [waist, jeans], measureLog: { [day(12)]: { waist: 34.7 }, [day(26)]: { waist: 34.4, fit: 'looser' } } });
  const by = Object.fromEntries(C.judgeSteps(st, day(28)).map(r => [r.key, r]));
  assert.strictEqual(by['gA|1|w|1'].result, 'skipped');
  assert.strictEqual(by['gA|1|w|1'].points, 0);
  assert.strictEqual(by['gA|1|w|2'].result, 'hit');
  assert.strictEqual(by['gA|0|m|1'].result, 'hit', 'the latest reading in the month');
  assert.strictEqual(by['gJ|0|m|1'].result, 'hit');
});

test('a habit step counts its own change’s week, wherever the pace put it', () => {
  const g = C.normalizeGoals([{ id: 'gS', key: 'sleep', text: 'Sleep 7 hours', measure: { kind: 'habit', by: '2026-12-01' },
    weeks: [{ swap: 2, target: 4 }], months: [{ n: 1, target: 3 }] }])[0];
  const it = C.normalizeItem({ id: 'lo', name: 'Lights out', kind: 'habit', core: false, swap: 2, goalId: 'sleep', addedAt: P });
  for (const [pace, from] of [['standard', day(7)], ['slower', day(14)], ['faster', P]]) {
    const [placed] = C.scheduleSwaps([it], { planStart: P, today: P, pace });
    assert.strictEqual(placed.addedAt, from, pace);
    const log = {};
    for (let d = 0; d < 4; d++) tick(log, placed, C.addDays(from, d), 22, 45);   // late ticks count
    const st = agreed({ goals: [g], items: [placed], log });
    assert.deepStrictEqual(C.judgeSteps(st, C.addDays(from, 6)), [], pace + ': not before its week ends');
    const rec = C.judgeSteps(st, C.addDays(from, 7)).find(r => r.key === 'gS|1|s|2');
    assert.strictEqual(rec.result, 'hit', pace);
    assert.strictEqual(rec.value, 4);
    assert.strictEqual(rec.points, 340);
  }
});

test('a "Did you hit it?" step waits a day for its answer, then counts as missed', () => {
  const g = C.normalizeGoals([{ id: 'gP', key: 'pushups', text: '25 push-ups', measure: { kind: 'report', by: '2026-12-01' },
    months: [{ n: 1, target: '25 in a row' }], weeks: [{ n: 1, target: '15 in a row' }, { n: 2, target: '18 in a row' }] }])[0];
  const st = agreed({ goals: [g], stepAnswers: { 'gP|1|w|2': true } });
  assert.strictEqual(C.judgeSteps(st, day(7)).find(r => r.key === 'gP|1|w|1'), undefined, 'the day after: still time');
  assert.strictEqual(C.judgeSteps(st, day(8)).find(r => r.key === 'gP|1|w|1').result, 'missed');
  assert.strictEqual(C.judgeSteps(st, day(10)).find(r => r.key === 'gP|1|w|2').result, 'hit', 'a yes counts at once');
});

test('no steps before the goals are agreed', () => {
  const g = C.normalizeGoals([Object.assign(weightGoal(), { id: 'gW' })])[0];
  assert.deepStrictEqual(C.judgeSteps(agreed({ goals: [g], goalsAgreedAt: null }), day(40)), []);
});

// ── points and the ladder (4k.6, 4l.5, 4l.10) ─────────────────────────────

test('step points add to the total, and the ladder scales with the goals', () => {
  const items = [item({})];
  const pw = C.perfectWeek(items);                          // 140
  const goals = C.normalizeGoals([weightGoal(), Object.assign(weightGoal(), { key: 'waist' })]);
  assert.strictEqual(C.ladderWeek(items, [], pw), pw, 'no goals with steps: the perfect week');
  assert.strictEqual(C.ladderWeek(items, goals, pw), Math.round(pw + 2 * (C.stepValue('w', pw) + C.stepValue('m', pw) / 4)));
  const stepLog = { a: { result: 'hit', points: 20 }, b: { result: 'missed', points: 0 }, c: { result: 'hit', points: 140 } };
  assert.strictEqual(C.stepPoints(stepLog), 160);
  const p = C.progress(items, {}, { today: P, perfectWeek: pw, stepLog, ladder: { week: 300, fixed: {} } });
  assert.strictEqual(p.points, 160);
  assert.strictEqual(p.ladderWeek, 300);
  assert.strictEqual(p.level.rank, 'Lil Bro', '160 is short of Bro at 300');
});

test('a recommit never moves a reached rank: its threshold stays, the ones above rescale', () => {
  const first = C.ladderSnapshot(2380, null, 1);
  // Bro reached at 2,400 points; the new block brings more goals.
  const next = C.ladderSnapshot(4000, first, 2);
  assert.deepStrictEqual(next.fixed, { 1: 0, 2: 2400 });
  const t = C.levelThresholds(next.week, next.fixed);
  assert.deepStrictEqual(t.map(x => x.points), [0, 2400, 12000, 32000, 64000]);
  const bar = C.rankProgress(2500, next.week, 2, next.fixed);
  assert.strictEqual(bar.level.rank, 'Bro');
  assert.strictEqual(bar.next.rank, 'Bro Bro');
  assert.ok(bar.pct >= 0 && bar.pct <= 100);
  // Even a client whose points sit under a raised tier reads their own rank, never "N to Bro".
  const odd = C.rankProgress(2000, 4000, 2, {});
  assert.strictEqual(odd.level.rank, 'Bro', 'the ratchet holds the rank');
  assert.strictEqual(odd.next.rank, 'Bro Bro');
  assert.strictEqual(odd.pct, 0, 'clamped, never negative');
  assert.strictEqual(C.rankProgress(1e9, 100, 5, {}).next, null);
});

// ── the status (4k.5, 4l.4) ───────────────────────────────────────────────

test('steps travel in the status only when asked, six at a time, and validate', () => {
  const stepLog = {};
  for (let n = 1; n <= 8; n++) {
    const key = C.stepKey('gW', 1, 'w', n);
    stepLog[key] = { key, goal: 'gW', kind: 'w', n, block: 1, end: day(7 * n - 1), result: n % 2 ? 'hit' : 'missed',
      value: 190 + n / 10, target: 190.5, points: n % 2 ? 340 : 0, sent: n === 1 };
  }
  const st = Object.assign(agreed({ items: [item({})], stepLog, pace: 'faster' }));
  const plain = C.statusPayload(st, { today: day(60) });
  assert.strictEqual(plain.v, 1);
  assert.strictEqual(plain.steps, undefined);
  const p = C.statusPayload(st, { today: day(60), steps: true });
  assert.strictEqual(p.v, 2);
  assert.strictEqual(p.steps.pace, 'faster');
  assert.deepStrictEqual(p.steps.outcomes.map(o => o.n), [2, 3, 4, 5, 6, 7], 'unsent, oldest first, at most six');
  assert.ok(p.points >= 340 * 3, 'hits count toward the total');
  const ok = C.validateStatus(JSON.parse(JSON.stringify(p)));
  assert.strictEqual(ok.ok, true, ok.error);
  assert.strictEqual(ok.status.steps.outcomes.length, 6);
  assert.ok(JSON.stringify(p).length < 4096, 'under the worker’s body cap');
  const bad = o => C.validateStatus(Object.assign({}, p, { steps: Object.assign({}, p.steps, o) })).error;
  assert.ok(bad({ pace: 'warp' }));
  assert.ok(bad({ outcomes: p.steps.outcomes.concat(p.steps.outcomes) }), 'more than six');
  assert.ok(bad({ outcomes: [Object.assign({}, p.steps.outcomes[0], { key: 'x|1|w|9' })] }), 'the key must match');
  assert.ok(bad({ outcomes: [Object.assign({}, p.steps.outcomes[0], { result: 'maybe' })] }));
  assert.ok(bad({ outcomes: [Object.assign({}, p.steps.outcomes[0], { value: 'x'.repeat(200) })] }));
  assert.strictEqual(C.validateStatus(plain).status.steps, undefined, 'a version 1 status reads as ever');
});

// ── plan links (4k.7) ─────────────────────────────────────────────────────

test('swaps, steps and goals with steps survive a plan link, which goes out as version 3', () => {
  const items = C.normalizeItems([
    { name: 'Lights out', kind: 'habit', dueBy: '22:30', swap: 2, block: 1, replaces: '30 min of TV.', goalId: 'sleep',
      steps: [{ swap: 3, dueBy: '22:00', label: 'Lights out 10:00 pm' }], addedAt: P },
    { name: 'Zone 2', kind: 'habit', addedAt: P }
  ]);
  const goals = C.normalizeGoals([weightGoal()]);
  const code = C.encodePayload('plan', { items, goals });
  const out = C.decodePayload(code);
  assert.strictEqual(out.ok, true, out.error);
  assert.strictEqual(out.data.v, C.PAYLOAD_STEPS);
  assert.deepStrictEqual(out.data.items[0].steps, items[0].steps);
  assert.strictEqual(out.data.items[0].swap, 2);
  assert.strictEqual(out.data.items[0].replaces, '30 min of TV.');
  assert.deepStrictEqual(out.data.goals[0].measure, goals[0].measure);
  assert.deepStrictEqual(out.data.goals[0].weeks, goals[0].weeks);
  // A plan without any of it stays version 2, so a phone from before reads it.
  assert.strictEqual(C.decodePayload(C.encodePayload('plan', { items: [items[1]], goals: [] })).data.v, C.PAYLOAD_VERSION);
});

test('an app from before steps refuses a version 3 plan with its readable message', () => {
  // The check an older core runs: anything above its own PAYLOAD_VERSION.
  const code = C.encodePayload('plan', { items: C.normalizeItems([{ name: 'X', swap: 1 }]), goals: [] });
  const data = C.decodePayload(code).data;
  assert.ok(Number(data.v) > C.PAYLOAD_VERSION, 'an older app, which accepts only up to 2, refuses it');
  const tooNew = 'BMPLAN:' + Buffer.from(JSON.stringify({ v: C.PAYLOAD_STEPS + 1 }), 'utf8').toString('base64');
  assert.match(C.decodePayload(tooNew).error, /newer version/);
});

// ── drafts (4b, 4i) ───────────────────────────────────────────────────────

function goodDraft() {
  return {
    block: 1,
    budget: [{ day: 'work', need: 95, found: 110, from: '60 min free after work, 20 min phone, 30 min TV' },
             { day: 'off', need: 20, found: 30, from: 'phone in bed' }],
    items: [
      { name: 'Weigh-in', kind: 'habit', goal: 'weight' },
      { name: 'Calories 2,925 logged', kind: 'habit', goal: 'weight' },
      { name: 'Zone 2', kind: 'habit', swap: 1, replaces: 'Coffee and phone on the couch.' },
      { name: 'Last coffee', kind: 'habit', dueBy: '13:00', swap: 2, replaces: 'The afternoon coffees.' },
      { name: 'Lights out', kind: 'habit', dueBy: '22:30', swap: 3, goal: 'sleep', replaces: '30 min of TV.',
        steps: [{ swap: 4, dueBy: '21:30', label: 'Lights out 9:30 pm' }] }
    ],
    goals: [
      weightGoal(),
      { key: 'sleep', text: 'Sleep 7 hours', term: 'short', why: 'I snack to stay awake.', measure: { kind: 'habit', by: '2026-10-25' },
        months: [{ n: 1, target: 5 }], weeks: [{ swap: 3, target: 4 }, { swap: 4, target: 5 }] },
      { text: 'Face looks younger at 50', term: 'long' }
    ]
  };
}

test('a draft with goals, swaps and a budget passes, and items point at their goal by key', () => {
  const out = C.validateDraft(goodDraft(), { planStart: P });
  assert.strictEqual(out.ok, true, out.errors.join('\n'));
  assert.strictEqual(out.items[0].goalId, 'weight');
  assert.strictEqual(out.items[4].steps.length, 1);
  assert.strictEqual(out.items[3].swap, 2);
  assert.strictEqual(out.goals[0].key, 'weight');
  assert.strictEqual(out.goals[2].measure, undefined, 'a plain goal stays plain');
  assert.strictEqual(out.block, 1);
  assert.strictEqual(out.budget.length, 2);
  assert.strictEqual(C.goalLink(out.goals[0]), out.items[0].goalId);
});

test('a draft from before steps still passes exactly as before', () => {
  const out = C.validateDraft({ items: [{ name: 'Zone 2', kind: 'habit' }], goals: [{ text: 'Hold 185', term: 'long' }] });
  assert.strictEqual(out.ok, true, out.errors.join('\n'));
  assert.strictEqual(out.items[0].swap, 0);
});

test('the draft checks name each problem', () => {
  const errs = mut => { const d = goodDraft(); mut(d); return C.validateDraft(d, { planStart: P }).errors.join('\n'); };
  assert.match(errs(d => { d.items[3].swap = 5; }), /numbered 1 to/);
  assert.match(errs(d => { d.items[2].swap = 2; }), /numbered 1 to/, 'a repeat');
  assert.match(errs(d => { delete d.budget; }), /needs a "budget"/);
  assert.match(errs(d => { d.budget[0].found = 80; }), /less than the 95 min needed/);
  assert.strictEqual(errs(d => { d.budget[0].found = 80; d.budget[0].cut = 'Four training days, not five.'; }), '');
  assert.match(errs(d => { delete d.goals[0].why; }), /needs a "why"/);
  assert.match(errs(d => { delete d.goals[0].key; }), /needs a key/);
  assert.match(errs(d => { d.goals[0].months = [{ n: 1, target: 205 }]; d.goals[0].measure.by = '2026-10-25'; }), /faster than the methods file allows/);
  assert.match(errs(d => { d.goals[0].months[5].target = 204; }), /must reach the target/);
  assert.match(errs(d => { d.goals[0].months[1].target = 191; }), /wrong way/);
  assert.match(errs(d => { d.goals[0].weeks.pop(); }), /four weekly steps/);
  assert.match(errs(d => { d.goals[1].weeks[0].swap = 9; }), /not in this draft/);
  assert.match(errs(d => { d.items[4].goal = 'nap'; }), /is not the key of a goal/);
  assert.match(errs(d => { d.items[4].goal = undefined; delete d.items[4].goal; }), /has no items/);
  assert.match(errs(d => { delete d.items[4].dueBy; }), /first time in dueBy/);
  assert.match(errs(d => { d.items[4].steps[0].dueBy = '9:30 pm'; }), /HH:MM/);
});

test('mergeDraft reports a changed swap, goal or moving target as a change', () => {
  const existing = C.normalizeItems([{ id: 'a', name: 'Lights out', dueBy: '22:30', swap: 3 }]);
  const incoming = C.normalizeItems([{ name: 'Lights out', dueBy: '22:30', swap: 3, steps: [{ swap: 4, dueBy: '21:30' }] }]);
  const out = C.mergeDraft(existing, incoming, P);
  assert.deepStrictEqual(out.changed, ['Lights out']);
  assert.strictEqual(out.items[0].id, 'a', 'matched by name: history kept');
});

// ── CTO step 1 review: blocks, rates, frequencies ─────────────────────────

test('a block 2 draft landing on day 26 does not lose block 1 week 4: it is judged when it ends', () => {
  const g1 = C.normalizeGoals([Object.assign(weightGoal(), { id: 'gW' })])[0];
  const b2 = Object.assign(weightGoal(), { block: 2 });
  b2.weeks = [193, 193.5, 194, 194.5].map((t, i) => ({ n: i + 1, target: t }));
  const merged = C.mergeGoals([g1], [b2]).goals[0];
  assert.strictEqual(merged.id, 'gW');
  assert.strictEqual(merged.block, 2);
  assert.strictEqual(merged.past[0].block, 1);
  const wl = {};
  for (let d = 21; d < 28; d++) wl[day(d)] = 192.4;           // block 1 week 4: 192.4 against 192.5
  const st = agreed({ goals: [merged], weightLog: wl });
  const keys = C.judgeSteps(st, day(36)).map(r => r.key);
  assert.ok(keys.includes('gW|1|w|4'), 'block 1 week 4 is judged');
  assert.ok(keys.includes('gW|2|w|1'), 'and block 2 week 1');
  assert.strictEqual(C.judgeSteps(st, day(36)).find(r => r.key === 'gW|1|w|4').result, 'hit');
});

test('slower pace over two blocks: a block 1 habit step still under way is judged after block 2 renumbers', () => {
  const sleep = { key: 'sleep', text: 'Sleep 7 hours', measure: { kind: 'habit', by: '2026-12-31' }, months: [{ n: 1, target: 3 }] };
  const g1 = C.normalizeGoals([Object.assign({}, sleep, { id: 'gS', weeks: [{ swap: 3, target: 3 }] })])[0];
  const lo = C.normalizeItem({ id: 'lo', name: 'Lights out', swap: 3, goalId: 'sleep', core: false, addedAt: P });
  const [placed] = C.scheduleSwaps([lo], { planStart: P, today: P, pace: 'slower' });
  assert.strictEqual(placed.addedAt, day(28), 'swap 3 at slower is week 5');
  // Block 2 arrives on day 30: the change has started, so it loses its swap number.
  const g2 = C.mergeGoals([g1], [Object.assign({}, sleep, { block: 2, weeks: [{ swap: 1, target: 5 }] })], [placed]).goals[0];
  assert.deepStrictEqual(g2.past[0].weeks[0].from, day(28));
  const renumbered = C.normalizeItem(Object.assign({}, placed, { swap: 0, block: 2 }));
  const log = {};
  for (let d = 28; d < 32; d++) tick(log, placed, day(d), 22, 0);
  const rec = C.judgeSteps(agreed({ goals: [g2], items: [renumbered], log }), day(35)).find(r => r.key === 'gS|1|s|3');
  assert.strictEqual(rec.result, 'hit');
  assert.strictEqual(rec.value, 4);
});

test('an item that is no longer a swap starts today, not at its old future date', () => {
  const [s3] = C.scheduleSwaps([item({ id: 's3', swap: 3 })], { planStart: P, today: P });
  assert.strictEqual(s3.addedAt, day(14));
  const [plain] = C.scheduleSwaps([item({ id: 's3', swap: 0, addedAt: day(14) })], { planStart: P, today: day(2), prev: [s3] });
  assert.strictEqual(plain.addedAt, day(2));
});

test('the loss limits come from the methods table, and a stated reason lets a faster plan through', () => {
  const draft = (start, target, by, reason) => ({
    items: [{ name: 'Weigh-in', goal: 'weight' }],
    goals: [{ key: 'weight', text: target + ' lbs', why: 'Because.', measure: { kind: 'weight', start, target, by, rateReason: reason },
      months: [{ n: 1, target }], weeks: [1, 2, 3, 4].map(n => ({ n, target: start })) }]
  });
  const err = d => C.validateDraft(d, { planStart: P }).errors.join('\n');
  // 30 lb to lose is "about 1 lb a week": 30 lb in four weeks is far too fast.
  assert.match(err(draft(230, 200, '2026-10-25')), /faster than the methods file allows \(1 lb a week\)/);
  assert.match(err(draft(230, 200, '2026-10-25', 'GLP-1, 1 to 2 percent a week, methods 6b')), /^(?!.*faster)/s);
  // 60 lb to lose allows 2 lb a week; 10 lb allows 0.75.
  assert.match(err(draft(260, 200, '2026-10-25')), /\(2 lb a week\)/);
  assert.match(err(draft(200, 190, '2026-10-25')), /\(0.75 lb a week\)/);
  // A gain is at most half a percent of body weight a week.
  assert.match(err(draft(190, 205, '2026-10-25')), /\(0.95 lb a week\)/);
});

test('a habit target can be no more than its item can be ticked in a week, and months must reach the date', () => {
  const errs = mut => { const d = goodDraft(); mut(d); return C.validateDraft(d, { planStart: P }).errors.join('\n'); };
  assert.match(errs(d => { d.items[4].freq = 'weekly'; d.items[4].days = [0, 2, 4]; d.goals[1].weeks[0].target = 4; }), /must be 1 to 3 days/);
  assert.match(errs(d => { d.goals[0].measure.by = '2027-09-30'; }), /not near its date/);
  assert.match(errs(d => { d.goals.push({ key: 'jeans', text: 'Jeans fit', why: 'Closet.', measure: { kind: 'fit', target: 'looser', by: '2026-10-25' },
    months: [{ n: 1, target: 'baggy' }] }); d.items[0].goal = 'jeans'; d.items.push({ name: 'Weigh-in 2', goal: 'weight' }); }), /each step.s target is one of/);
});

test('a step with no usable target is closed as skipped, never left open', () => {
  const g = C.normalizeGoals([{ id: 'gJ', key: 'jeans', text: 'Jeans', measure: { kind: 'fit', target: 'looser', by: '2027-01-01' },
    months: [{ n: 1, target: 'baggy' }] }])[0];
  const rec = C.judgeSteps(agreed({ goals: [g] }), day(28)).find(r => r.key === 'gJ|0|m|1');
  assert.strictEqual(rec.result, 'skipped');
});

// ── build step 3: the intake for finding the time ─────────────────────────

test('the Aggressive or Slow answer moves the loss limit one row of the deficit table', () => {
  const draft = (start, target, by) => ({
    items: [{ name: 'Weigh-in', goal: 'weight' }],
    goals: [{ key: 'weight', text: target + ' lbs', why: 'Because.', measure: { kind: 'weight', start, target, by },
      months: [{ n: 1, target }], weeks: [1, 2, 3, 4].map(n => ({ n, target: start })) }]
  });
  const err = (d, cutPace) => C.validateDraft(d, { planStart: P, cutPace }).errors.join('\n');
  // 4 lbs in four weeks is 1 lb a week: too fast under 20 lbs, fine when Aggressive.
  const four = draft(200, 196, '2026-10-26');
  assert.match(err(four), /0.75 lb a week/);
  assert.strictEqual(err(four, 'aggressive'), '');
  // 30 lbs to lose over 30 weeks is 1 lb a week: fine as it is, too fast at Slow.
  const thirty = draft(230, 200, C.addDays(P, 210));
  thirty.goals[0].months = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ n, target: n === 8 ? 200 : 230 - n * 3.75 }));
  assert.strictEqual(err(thirty), '');
  assert.match(err(thirty, 'slow'), /0.75 lb a week/);
});

test('the routine pages ask where the time goes, each with its band', () => {
  const [work, off, most] = C.routineSections();
  assert.strictEqual(work.lead, 'Time is the most valuable asset you have. Don\u2019t waste it.');
  assert.strictEqual(off.lead, 'Don\u2019t let the weekend become your weak end.');
  assert.strictEqual(most.lead, 'Motivation is what gets you started. Habit is what keeps you going.');
  const keys = s => s.fields.map(f => f.key);
  assert.ok(['workMorning', 'workCommuteEach', 'workLunch', 'workScreens'].every(k => keys(work).includes(k)));
  assert.ok(['offMorning', 'offScreens'].every(k => keys(off).includes(k)));
  assert.ok(!keys(off).some(k => /Commute|Lunch/.test(k)), 'no commute or lunch on a day off');
  assert.ok(C.intakeFields().find(f => f.key === 'offMorning').options.includes('sleeping in'));
  // Lunch goes with no set work hours; the commute stays.
  const shown = a => C.visibleFields(work, a).map(f => f.key);
  assert.ok(!shown({ job: 'no set work hours' }).includes('workLunch'));
  assert.ok(shown({ job: 'no set work hours' }).includes('workCommuteEach'));
  // What never moves, and the trade, each with a box for something else.
  assert.deepStrictEqual(keys(most).slice(-5), ['fixedTime', 'fixedMore', 'trade', 'tradeMore', 'mostMore']);
  assert.strictEqual(most.fields.find(f => f.key === 'trade').none, 'nothing');
});

test('the new routine answers reach the baseline, and a first answer to one is not a change', () => {
  const before = { workWake: '5am', workBed: '11pm' };
  const after = { workWake: '5am', workBed: '11pm', workMorning: 'coffee\nphone', workScreens: '2 to 3 hours',
    fixedTime: 'family dinner', fixedMore: 'date night', trade: 'TV\nphone' };
  const b = C.routineBaseline(after);
  assert.strictEqual(b.work.morning, 'coffee, phone');
  assert.strictEqual(b.work.screens, '2 to 3 hours');
  assert.strictEqual(b.most.fixed, 'family dinner, date night');
  assert.strictEqual(b.most.trade, 'TV, phone');
  assert.deepStrictEqual(C.routineChanges(before, after), [], 'never asked before, so not a change');
  const later = Object.assign({}, after, { workScreens: '1 to 2 hours' });
  assert.deepStrictEqual(C.routineChanges(after, later).map(c => [c.key, c.from, c.to]), [['workScreens', '2 to 3 hours', '1 to 2 hours']]);
});

test('a "none" or "nothing" tap gives way to words typed in the box below it', () => {
  const b = C.routineBaseline({ fixedTime: 'none', fixedMore: 'Date night', trade: 'nothing', tradeMore: 'happy hour' });
  assert.strictEqual(b.most.fixed, 'Date night');
  assert.strictEqual(b.most.trade, 'happy hour');
  const plain = C.routineBaseline({ trade: 'nothing' });
  assert.strictEqual(plain.most.trade, 'nothing', 'a real nothing stays a nothing');
  const most = C.routineSections()[2];
  assert.deepStrictEqual(most.fields.filter(f => f.moreOf).map(f => [f.key, f.moreOf]), [['fixedMore', 'fixedTime'], ['tradeMore', 'trade']]);
});
