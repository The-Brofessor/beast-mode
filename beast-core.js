/* ==========================================================================
   Beast Mode Core
   --------------------------------------------------------------------------
   The shared data contract for the client app (index.html, here) and the
   trainer dashboard (served by the private brofessor-coach worker at
   dash.thebrofessor.coach, which loads this same file from the app).

   Classic script, not an ES module: it publishes one global, window.BeastCore,
   so the 100+ inline onclick handlers in both apps keep resolving against
   window. The export tail at the bottom lets Node's test runner require this
   same file unchanged.

   Both apps must call into this file rather than reimplementing any of it.
   A log key or metric name written inline in an HTML file is how the two apps
   drifted apart before, and it is what the grep guard looks for.
   ========================================================================== */

var BeastCore = (function () {
  'use strict';

  // Bumped whenever the contract changes. Each app declares the version it was
  // built against and checks it at boot. GitHub Pages serves with a 600s cache
  // and no revalidation, so a phone can hold new HTML against an old core.
  var VERSION = '2.13.0';

  // Payload schema version. An app receiving a higher number refuses the
  // import instead of guessing at a shape it does not know.
  var PAYLOAD_VERSION = 2;

  // ── Vocabulary ────────────────────────────────────────────────────────────

  // 'ancillary' is appended rather than inserted: the wire format encodes kind
  // as an index into this list, so reordering it would silently rewrite every
  // item in a payload.
  var KINDS = ['exercise', 'supplement', 'habit', 'ancillary'];
  var FREQS = ['daily', 'weekly', 'flexible', 'monthly'];

  // These names are the ones brofessor-methods.md already tells the coach to
  // use. Renaming them would silently invalidate every plan draft he writes.
  // Only 'checkbox' is gone from the old list, because a tap now completes any
  // item whatever its kind.
  var METRICS = [
    'reps', 'sets_reps', 'sets_reps_weight',
    'duration', 'sets_duration', 'distance_time', 'makes_attempts', 'notes'
  ];

  // Which numbers a metric asks for, in display order. Both apps read this
  // rather than hardcoding field names, so a new metric is a one-line change
  // here instead of an edit in three files.
  var TARGET_FIELDS = {
    reps:             [{ key: 'reps', label: 'Reps' }],
    sets_reps:        [{ key: 'sets', label: 'Sets' }, { key: 'reps', label: 'Reps' }],
    sets_reps_weight: [{ key: 'sets', label: 'Sets' }, { key: 'reps', label: 'Reps' }, { key: 'weight', label: 'Weight' }],
    duration:         [{ key: 'minutes', label: 'Min' }, { key: 'seconds', label: 'Sec' }],
    sets_duration:    [{ key: 'sets', label: 'Sets' }, { key: 'minutes', label: 'Min' }, { key: 'seconds', label: 'Sec' }],
    distance_time:    [{ key: 'distance', label: 'Distance' }, { key: 'minutes', label: 'Min' }, { key: 'seconds', label: 'Sec' }],
    makes_attempts:   [{ key: 'makes', label: 'Makes' }, { key: 'attempts', label: 'Attempts' }],
    notes:            []
  };

  var METRIC_LABELS = {
    reps: 'Reps', sets_reps: 'Sets x Reps', sets_reps_weight: 'Sets x Reps x Weight',
    duration: 'Duration', sets_duration: 'Sets x Duration',
    distance_time: 'Distance and Time', makes_attempts: 'Makes / Attempts',
    notes: 'Free text notes'
  };

  function metricLabel(metric) { return METRIC_LABELS[metric] || metric; }
  function targetFields(metric) { return TARGET_FIELDS[metric] || []; }

  function clock(t) {
    var m = Number(t.minutes) || 0, s = Number(t.seconds) || 0;
    if (!m && !s) return '';
    if (!s) return m + ' min';
    if (!m) return s + ' sec';
    return m + ':' + pad2(s);
  }

  // Every weight in Beast Mode is in pounds.
  var WEIGHT_UNIT = 'lb';

  // "3 x 12 @ 135" / "20 min" / "1.5 in 12:30" / "" when nothing is set.
  // With `display`, the client-facing form: "3 × 12 at 135 lb". The plain form
  // is what the dashboard and the coach already read, so it does not change.
  function formatTarget(detail, display) {
    if (!detail || !detail.target) return '';
    var t = detail.target;
    var x = display ? ' × ' : ' x ';
    switch (detail.metric) {
      case 'reps':             return t.reps ? t.reps + ' reps' : '';
      case 'sets_reps':        return (t.sets && t.reps) ? t.sets + x + t.reps : '';
      case 'sets_reps_weight':
        if (!t.sets || !t.reps) return '';
        if (!t.weight) return t.sets + x + t.reps;
        return t.sets + x + t.reps + (display ? ' at ' + t.weight + ' ' + WEIGHT_UNIT : ' @ ' + t.weight);
      case 'duration':         return clock(t);
      case 'sets_duration':    return (t.sets && clock(t)) ? t.sets + x + clock(t) : '';
      case 'distance_time':
        if (!t.distance) return '';
        return clock(t) ? t.distance + ' in ' + clock(t) : String(t.distance);
      case 'makes_attempts':   return t.attempts ? (t.makes || 0) + ' / ' + t.attempts : '';
      default:                 return '';
    }
  }

  // Hyphenated, matching the shipped app and the seven labels in
  // brofessor-methods.md section 6. 'custom' is gone: it needed a second
  // free-text field, and 'as-needed' plus the item note covers it.
  var TIMINGS = [
    'morning', 'pre-workout', 'intra-workout', 'post-workout',
    'evening', 'before-bed', 'with-meals', 'as-needed'
  ];

  // What a client reads for each timing, after the amount: "5 g, <label>".
  // Display only. The names above are the contract and never change here.
  var TIMING_LABELS = {
    'morning':       'in the morning',
    'pre-workout':   'before your workout',
    'intra-workout': 'during your workout',
    'post-workout':  'after your workout',
    'evening':       'in the evening',
    'before-bed':    'before bed',
    'with-meals':    'with a meal',
    'as-needed':     'when you need it'
  };

  // A timing with no label still reads sensibly: 'pre-workout' -> 'Pre workout'.
  function timingLabel(t) {
    if (TIMING_LABELS[t]) return TIMING_LABELS[t];
    var s = String(t || '').replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Monday-aligned. DAYS[0] is Monday so weekday maths matches getWeekDates().
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ── Scoring constants ─────────────────────────────────────────────────────

  var POINTS = {
    base: 10,          // every completed item
    onTime: 10,        // completed on its own date, at or before dueBy
    perfectDay: 10     // multiplied by the day's scheduled core count
  };

  // Multiples of the client's snapshotted perfectWeek.
  var LEVELS = [
    { level: 1, rank: 'Lil Bro',         multiple: 0 },
    { level: 2, rank: 'Bro',             multiple: 1 },
    { level: 3, rank: 'Bro Bro',         multiple: 3 },
    { level: 4, rank: 'Broton Beam',     multiple: 8 },
    { level: 5, rank: 'Chief Brologist', multiple: 16 }
  ];

  // ── Dates ─────────────────────────────────────────────────────────────────
  // Every date in this file is a local 'YYYY-MM-DD' string. toISOString() is
  // never used for a calendar date: it converts to UTC and rolls the day over
  // for anyone west of Greenwich in the evening.

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayLocal() {
    return dateToLocal(new Date());
  }

  function dateToLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 'YYYY-MM-DD' -> Date at local midnight. Splitting the string avoids
  // new Date('2026-09-19') being parsed as UTC midnight.
  function localToDate(ymd) {
    var p = String(ymd).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  // Local calendar date an ISO timestamp falls on, in the reader's timezone.
  function localDateOf(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : dateToLocal(d);
  }

  function addDays(ymd, n) {
    var d = localToDate(ymd);
    d.setDate(d.getDate() + n);
    return dateToLocal(d);
  }

  // 0 = Monday ... 6 = Sunday.
  function weekdayIndex(ymd) {
    return (localToDate(ymd).getDay() + 6) % 7;
  }

  function mondayOf(ymd) {
    return addDays(ymd, -weekdayIndex(ymd));
  }

  // The seven local dates of the week containing ymd, Monday first.
  function getWeekDates(ymd) {
    var mon = mondayOf(ymd);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(mon, i));
    return out;
  }

  function daysBetween(fromYmd, toYmd) {
    var ms = localToDate(toYmd).getTime() - localToDate(fromYmd).getTime();
    return Math.round(ms / 86400000);
  }

  // Inclusive list of local dates.
  function datesBetween(fromYmd, toYmd) {
    var out = [];
    var n = daysBetween(fromYmd, toYmd);
    for (var i = 0; i <= n; i++) out.push(addDays(fromYmd, i));
    return out;
  }

  // 'HH:MM' -> minutes since local midnight, or null.
  function minutesOfDay(hhmm) {
    if (!hhmm) return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function formatDueBy(hhmm) {
    var mins = minutesOfDay(hhmm);
    if (mins === null) return '';
    var h = Math.floor(mins / 60), m = mins % 60;
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + pad2(m) : '') + ampm;
  }

  // ── Escaping ──────────────────────────────────────────────────────────────
  // Both apps render trainer- and model-supplied strings into HTML. Phase 4
  // pastes LLM-generated JSON straight into the trainer app, so these live
  // here rather than being redefined per file.

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escHTMLAttr(s) { return escapeHtml(s); }
  function escText(s) { return String(s == null ? '' : s).replace(/[<>]/g, ''); }

  // The editable detail fields per kind, so the trainer builds its form from
  // here rather than branching on a kind name. Exercise is absent on purpose:
  // its metric drives a cascade into targetFields(), which has its own shape.
  var DETAIL_FIELDS = {
    exercise: [],
    supplement: [
      { key: 'dosage', label: 'Dosage', type: 'text' },
      { key: 'timing', label: 'Timing', type: 'select', options: TIMINGS }
    ],
    ancillary: [
      { key: 'dose', label: 'Dose', type: 'text', hint: '7.5mg' },
      { key: 'prescriber', label: 'Prescriber', type: 'text' },
      { key: 'followUp', label: 'Next follow-up', type: 'text', hint: 'YYYY-MM-DD' }
    ],
    habit: []
  };

  function detailFields(kind) { return DETAIL_FIELDS[kind] || []; }
  function usesMetric(kind) { return kind === KINDS[0]; }   // exercise

  // What an item shows under its name, by kind. Keeps every app out of the
  // business of knowing which detail fields a kind carries.
  function detailLine(it) {
    var d = it.detail || {};
    if (usesMetric(it.kind)) return formatTarget(d);
    var first = detailFields(it.kind)[0];
    return (first && d[first.key]) ? String(d[first.key]) : '';
  }

  // The line a client reads under an item: how much, then when. Never the
  // item kind. "3 × 10 at 35 lb" / "5g, in the morning" / "Before bed".
  function itemSummary(it) {
    var d = (it && it.detail) || {};
    var parts = [];
    var amount = usesMetric(it.kind) ? formatTarget(d, true) : detailLine(it);
    if (amount) parts.push(amount);
    if (d.timing) parts.push(timingLabel(d.timing));
    var s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Ids ───────────────────────────────────────────────────────────────────
  // '|' is the log key separator, so it can never appear in an id.

  function newId() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isValidId(id) {
    return typeof id === 'string' && id.length > 0 && id.indexOf('|') === -1;
  }

  // ── Log keys ──────────────────────────────────────────────────────────────
  // Keyed on the absolute local date. Week/day numbers are derived for display
  // only: the old '{id}|w{week}d{day}' form was anchored to a startDate that
  // both migrateState and goal agreement reset, silently remapping every key.

  function logKey(itemId, ymd) {
    if (!isValidId(itemId)) throw new Error('Invalid item id for log key: ' + itemId);
    return itemId + '|' + ymd;
  }

  function parseLogKey(key) {
    var i = String(key).indexOf('|');
    if (i === -1) return null;
    return { id: key.slice(0, i), date: key.slice(i + 1) };
  }

  // ── Normalizers ───────────────────────────────────────────────────────────

  // Defaults for `core` when a payload or a Brofessor draft omits it.
  // Habits default to gating because the ones Chris assigns are the
  // non-negotiables: Zone 2, steps, water, protein, weigh-in. Exercises do not,
  // because a training day flattens into six or more separate taps and the last
  // accessory would break a streak. Supplements do not, because a missed
  // multivitamin is not a missed day.
  // An ancillary defaults non-core on purpose. Its timing belongs to the
  // prescriber, clients shift an injection day by a day fairly often, and a
  // streak broken by that would punish something the plan does not control.
  // Chris can set it core per client.
  var DEFAULT_CORE_BY_KIND = {
    exercise: false,
    supplement: false,
    habit: true,
    ancillary: false
  };

  function normalizeItem(raw, opts) {
    opts = opts || {};
    var it = raw || {};
    var kind = KINDS.indexOf(it.kind) !== -1 ? it.kind : 'habit';
    var freq = FREQS.indexOf(it.freq) !== -1 ? it.freq : 'daily';
    var days = Array.isArray(it.days) ? it.days.filter(function (d) {
      return Number.isInteger(d) && d >= 0 && d <= 6;
    }) : [];

    // A weekly item with no chosen days has no day obligation, which is what
    // 'flexible' already means. Collapsing it here removes a second shape that
    // every scheduling and scoring rule would otherwise have to special-case.
    var timesPerWeek = Number(it.timesPerWeek) > 0 ? Math.floor(Number(it.timesPerWeek)) : 1;
    if (freq === 'weekly' && days.length === 0) {
      freq = 'flexible';
    }
    if (freq === 'daily' || freq === 'weekly') timesPerWeek = 0;

    var core = typeof it.core === 'boolean' ? it.core : !!DEFAULT_CORE_BY_KIND[kind];
    // Flexible and monthly items land on no particular day, so they cannot
    // gate one. Forced here so no caller has to remember it.
    if (freq === 'flexible' || freq === 'monthly') core = false;

    var detail = it.detail && typeof it.detail === 'object' ? it.detail : {};
    if (kind === 'exercise') {
      detail = {
        metric: METRICS.indexOf(detail.metric) !== -1 ? detail.metric : 'sets_reps',
        target: detail.target && typeof detail.target === 'object' ? detail.target : {}
      };
    } else if (kind === 'supplement') {
      detail = {
        dosage: detail.dosage == null ? '' : String(detail.dosage),
        timing: TIMINGS.indexOf(detail.timing) !== -1 ? detail.timing : 'morning'
      };
    } else if (kind === 'ancillary') {
      // Prescribed: GLP-1s, TRT, thyroid, blood pressure. The item's own freq,
      // days and dueBy hold when it is taken, so detail holds only the clinical
      // facts. Dose belongs to the prescriber and is recorded, never set here.
      detail = {
        dose: detail.dose == null ? '' : String(detail.dose),
        prescriber: detail.prescriber == null ? '' : String(detail.prescriber),
        followUp: detail.followUp == null ? '' : String(detail.followUp)
      };
    } else {
      detail = {};
    }

    return {
      id: isValidId(it.id) ? it.id : newId(),
      name: it.name == null ? '' : String(it.name),
      kind: kind,
      group: it.group == null ? '' : String(it.group),
      core: core,
      freq: freq,
      days: freq === 'weekly' ? days.slice().sort(function (a, b) { return a - b; }) : [],
      timesPerWeek: timesPerWeek,
      dueBy: minutesOfDay(it.dueBy) === null ? '' : String(it.dueBy).trim(),
      goalId: it.goalId == null ? '' : String(it.goalId),
      notes: it.notes == null ? '' : String(it.notes),
      trainerNotes: it.trainerNotes == null ? '' : String(it.trainerNotes),
      // An item never exists before the date it entered the plan. Without this
      // an added item makes every earlier day retroactively incomplete and the
      // streak evaluates to zero on the first backward step.
      addedAt: it.addedAt || opts.addedAt || todayLocal(),
      detail: detail
    };
  }

  function normalizeItems(list, opts) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.map(function (raw) {
      var it = normalizeItem(raw, opts);
      while (seen[it.id]) it.id = newId();   // ids must be unique within a plan
      seen[it.id] = true;
      return it;
    });
  }

  function normalizeGoals(goals) {
    if (!Array.isArray(goals)) return [];
    return goals.map(function (g) {
      if (typeof g === 'string') return { id: newId(), text: g, term: 'short', completed: false };
      return {
        id: isValidId(g && g.id) ? g.id : newId(),
        text: g && g.text != null ? String(g.text) : '',
        term: g && g.term === 'long' ? 'long' : 'short',
        completed: !!(g && g.completed)
      };
    }).filter(function (g) { return g.text.trim() !== ''; });
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  function existsOn(item, ymd) {
    return ymd >= item.addedAt;          // 'YYYY-MM-DD' sorts lexicographically
  }

  // True when the item carries a day obligation on this date. Flexible and
  // monthly items are tappable but never owe a specific day, so they are false.
  function isScheduled(item, ymd) {
    if (!existsOn(item, ymd)) return false;
    if (item.freq === 'daily') return true;
    if (item.freq === 'weekly') return item.days.indexOf(weekdayIndex(ymd)) !== -1;
    return false;
  }

  // True when the item can be ticked on this date at all.
  function isAvailable(item, ymd) {
    if (!existsOn(item, ymd)) return false;
    if (item.freq === 'flexible' || item.freq === 'monthly') return true;
    return isScheduled(item, ymd);
  }

  function scheduledOn(items, ymd) {
    return items.filter(function (it) { return isScheduled(it, ymd); });
  }

  function scheduledCoreOn(items, ymd) {
    return scheduledOn(items, ymd).filter(function (it) { return it.core; });
  }

  // ── Completion ────────────────────────────────────────────────────────────

  function entryFor(log, itemId, ymd) {
    return log[logKey(itemId, ymd)] || null;
  }

  function isDone(log, itemId, ymd) {
    var e = entryFor(log, itemId, ymd);
    return !!(e && e.done);
  }

  // A tick only counts toward its own date when it happened on that date.
  // This is what stops back-filling from repairing a broken streak, without
  // needing any stored per-day state.
  function isSameDay(entry, ymd) {
    return !!(entry && entry.done && localDateOf(entry.completedAt) === ymd);
  }

  function isOnTime(item, entry, ymd) {
    if (!isSameDay(entry, ymd)) return false;
    var due = minutesOfDay(item.dueBy);
    if (due === null) return true;          // no dueBy means it can never be late
    var d = new Date(entry.completedAt);
    return (d.getHours() * 60 + d.getMinutes()) <= due;
  }

  function markDone(log, item, ymd, done, values) {
    var key = logKey(item.id, ymd);
    if (!done) { delete log[key]; return log; }
    log[key] = {
      done: true,
      completedAt: new Date().toISOString(),
      values: values && typeof values === 'object' ? values : {}
    };
    return log;
  }

  // ── Day results ───────────────────────────────────────────────────────────

  // gate:
  //   'closed'  every scheduled core item was completed on the day itself
  //   'broken'  at least one scheduled core item was missed
  //   'neutral' no core items were scheduled; holds a streak without extending
  // The three ways a day can end. `neutral` is a day with no core item
  // scheduled: it holds the streak without adding to it.
  var GATES = { closed: 'closed', broken: 'broken', neutral: 'neutral' };

  function dayResult(items, log, ymd) {
    var core = scheduledCoreOn(items, ymd);
    var gate = GATES.neutral;
    if (core.length) {
      gate = core.every(function (it) {
        return isSameDay(entryFor(log, it.id, ymd), ymd);
      }) ? GATES.closed : GATES.broken;
    }

    var points = 0;
    var completed = 0;
    items.forEach(function (it) {
      if (!isAvailable(it, ymd)) return;
      var e = entryFor(log, it.id, ymd);
      if (!e || !e.done) return;
      completed++;
      points += POINTS.base;
      if (isOnTime(it, e, ymd)) points += POINTS.onTime;
    });

    var bonus = gate === 'closed' ? POINTS.perfectDay * core.length : 0;

    return {
      date: ymd,
      gate: gate,
      scheduled: scheduledOn(items, ymd).length,
      scheduledCore: core.length,
      completed: completed,
      points: points + bonus,
      perfectBonus: bonus
    };
  }

  function programStart(items) {
    if (!items.length) return null;
    return items.reduce(function (min, it) {
      return (min === null || it.addedAt < min) ? it.addedAt : min;
    }, null);
  }

  // ── Streak ────────────────────────────────────────────────────────────────

  // Walks backward from yesterday. Today is excluded because a day is not
  // judged until it ends; including it shows a client a zero every morning.
  function currentStreak(items, log, today) {
    today = today || todayLocal();
    var start = programStart(items);
    if (!start) return 0;

    var n = 0;
    var d = addDays(today, -1);
    while (d >= start) {
      var gate = dayResult(items, log, d).gate;
      if (gate === 'broken') break;
      if (gate === 'closed') n++;
      d = addDays(d, -1);
    }
    return n;
  }

  function bestStreak(items, log, today) {
    today = today || todayLocal();
    var start = programStart(items);
    if (!start) return 0;

    var best = 0, run = 0;
    datesBetween(start, addDays(today, -1)).forEach(function (d) {
      var gate = dayResult(items, log, d).gate;
      if (gate === 'broken') run = 0;
      else if (gate === 'closed') { run++; if (run > best) best = run; }
    });
    return best;
  }

  // ── Points and levels ─────────────────────────────────────────────────────

  function totalPoints(items, log, today) {
    today = today || todayLocal();
    var start = programStart(items);
    if (!start) return 0;
    return datesBetween(start, today).reduce(function (sum, d) {
      return sum + dayResult(items, log, d).points;
    }, 0);
  }

  // Base plus on-time for everything a full week owes. The perfect-day bonus
  // is deliberately excluded: it is a step function that collapses
  // nonlinearly at less than perfect adherence, and collapses harder on
  // bigger plans, which made the ladder steeper for clients with more items.
  function perfectWeek(items) {
    var perItem = POINTS.base + POINTS.onTime;
    return items.reduce(function (sum, it) {
      if (it.freq === 'daily') return sum + 7 * perItem;
      if (it.freq === 'weekly') return sum + it.days.length * perItem;
      if (it.freq === 'flexible') return sum + it.timesPerWeek * perItem;
      return sum;                          // monthly contributes nothing
    }, 0);
  }

  function roundTo50(n) { return Math.round(n / 50) * 50; }

  function levelThresholds(pw) {
    return LEVELS.map(function (l) {
      return { level: l.level, rank: l.rank, points: roundTo50(l.multiple * pw) };
    });
  }

  // `pw` is the perfectWeek snapshotted at goal agreement, so a later plan
  // update cannot move the ladder under a client who has not lost a point.
  function levelFor(points, pw, earnedLevel) {
    var tiers = levelThresholds(pw);
    var reached = tiers[0];
    tiers.forEach(function (t) { if (points >= t.points) reached = t; });
    // Ratchet: a rank once earned is never lost.
    if (earnedLevel && earnedLevel > reached.level) {
      reached = tiers[earnedLevel - 1] || reached;
    }
    return reached;
  }

  function progress(items, log, opts) {
    opts = opts || {};
    var today = opts.today || todayLocal();
    var pw = opts.perfectWeek || perfectWeek(items);
    var pts = totalPoints(items, log, today);
    return {
      points: pts,
      perfectWeek: pw,
      streak: currentStreak(items, log, today),
      bestStreak: bestStreak(items, log, today),
      level: levelFor(pts, pw, opts.earnedLevel)
    };
  }

  // ── Daily status ──────────────────────────────────────────────────────────
  // What the phone sends the server about the day (routine change loop brief,
  // 3a): the numbers already on the client's screen, nothing else. Built here
  // so the app and the worker share one vocabulary; checked here so the
  // worker refuses anything that is not this shape.

  var STATUS_VERSION = 1;
  var STATUS_FIELDS = ['streak', 'bestStreak', 'points', 'dayPoints', 'level', 'scheduled', 'done', 'scheduledCore', 'doneCore', 'day'];

  function statusPayload(state, opts) {
    opts = opts || {};
    var items = (state && state.items) || [];
    var log = (state && state.log) || {};
    var today = opts.today || todayLocal();
    var p = progress(items, log, { today: today, perfectWeek: state && state.perfectWeek, earnedLevel: state && state.earnedLevel });
    var due = scheduledOn(items, today);
    var core = scheduledCoreOn(items, today);
    var doneOf = function (list) { return list.filter(function (it) { return isDone(log, it.id, today); }).length; };
    var y = addDays(today, -1);
    var yr = dayResult(items, log, y);
    var tr = dayResult(items, log, today);
    var start = programStart(items);
    return {
      v: STATUS_VERSION,
      date: today,
      tz: opts.tz || '',
      streak: p.streak,
      bestStreak: p.bestStreak,
      points: p.points,
      dayPoints: tr.points,
      rank: p.level.rank,
      level: p.level.level,
      scheduled: due.length,
      done: doneOf(due),
      scheduledCore: core.length,
      doneCore: doneOf(core),
      gate: tr.gate,
      yesterday: start && y >= start
        ? { date: y, gate: yr.gate, done: yr.completed, scheduled: yr.scheduled, points: yr.points }
        : null,
      startDate: start || null,
      day: start ? daysBetween(start, today) + 1 : null,
      pushId: opts.pushId || null,
      // Where the app is running: the home screen, or a browser tab. On
      // iPhone only the home-screen app keeps a plan and can be pushed to,
      // so Chris needs to see who has finished installing (loop brief 3e).
      standalone: opts.standalone === true ? true : opts.standalone === false ? false : null,
      sharing: opts.sharing !== false,
      nudges: opts.nudges === true ? true : opts.nudges === false ? false : null
    };
  }

  // The local calendar date now in a zone, or null if the zone is unknown.
  function todayIn(tz, now) {
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now || new Date()).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e) { return null; }
  }

  // Shape, vocabulary and bounds. Returns { ok, status } or { error }. A
  // plan link gets forwarded, so the token behind a status can leak: nothing
  // here trusts the phone. With opts.now the date must be today or a day
  // either side in the claimed zone, so a stray date cannot pin the roster.
  var STATUS_MAX_COUNT = 1000;      // items in a day
  var STATUS_MAX_POINTS = 10000000;
  var STATUS_MAX_DAYS = 3660;       // ten years of streak or program

  function validateStatus(raw, opts) {
    opts = opts || {};
    if (!raw || typeof raw !== 'object') return { error: 'The status is missing.' };
    if (Number(raw.v) > STATUS_VERSION) return { error: 'That status needs a newer server.' };
    var ymd = /^\d{4}-\d\d-\d\d$/;
    var whole = function (v, max) { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v && v <= max; };
    var out = {};
    if (!ymd.test(String(raw.date || '')) || isNaN(localToDate(raw.date).getTime())) return { error: 'The status needs a date.' };
    out.date = raw.date;
    if (raw.tz !== undefined && raw.tz !== null && raw.tz !== '') {
      if (typeof raw.tz !== 'string' || raw.tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(raw.tz) || !todayIn(raw.tz, opts.now)) return { error: 'Bad time zone.' };
      out.tz = raw.tz;
    } else out.tz = '';
    if (opts.now) {
      var today = todayIn(out.tz || 'UTC', opts.now);
      if (daysBetween(today, out.date) > 1 || daysBetween(out.date, today) > 1) return { error: 'That date is not today.' };
    }
    var limits = { streak: STATUS_MAX_DAYS, bestStreak: STATUS_MAX_DAYS, points: STATUS_MAX_POINTS, dayPoints: STATUS_MAX_POINTS,
      level: LEVELS.length, scheduled: STATUS_MAX_COUNT, done: STATUS_MAX_COUNT, scheduledCore: STATUS_MAX_COUNT, doneCore: STATUS_MAX_COUNT, day: STATUS_MAX_DAYS };
    for (var i = 0; i < STATUS_FIELDS.length; i++) {
      var k = STATUS_FIELDS[i], v = raw[k];
      if (v === null || v === undefined) { out[k] = null; continue; }
      if (!whole(v, limits[k])) return { error: 'Bad ' + k + '.' };
      out[k] = v;
    }
    if (out.done !== null && out.scheduled !== null && out.done > out.scheduled) return { error: 'Bad done.' };
    if (out.doneCore !== null && out.scheduledCore !== null && out.doneCore > out.scheduledCore) return { error: 'Bad doneCore.' };
    if (out.startDate = ymd.test(String(raw.startDate || '')) ? raw.startDate : null) {
      // A streak cannot be longer than the program.
      var span = daysBetween(out.startDate, out.date) + 1;
      if (span < 1) return { error: 'Bad startDate.' };
      if (out.streak !== null && out.streak > span) return { error: 'Bad streak.' };
      if (out.bestStreak !== null && out.bestStreak > span) return { error: 'Bad bestStreak.' };
    }
    if (raw.rank !== undefined && raw.rank !== null) {
      // The vocabulary is LEVELS; nothing else reaches the digest as a rank.
      var known = LEVELS.some(function (l) { return l.rank === raw.rank; });
      if (!known) return { error: 'Bad rank.' };
      out.rank = raw.rank;
    } else out.rank = null;
    if (!GATES[raw.gate]) return { error: 'Bad gate.' };
    out.gate = raw.gate;
    if (raw.yesterday) {
      var yv = raw.yesterday;
      if (typeof yv !== 'object' || yv.date !== addDays(out.date, -1) || !GATES[yv.gate] ||
          !whole(yv.done, STATUS_MAX_COUNT) || !whole(yv.scheduled, STATUS_MAX_COUNT) || !whole(yv.points, STATUS_MAX_POINTS) || yv.done > yv.scheduled) {
        return { error: 'Bad yesterday.' };
      }
      out.yesterday = { date: yv.date, gate: yv.gate, done: yv.done, scheduled: yv.scheduled, points: yv.points };
    } else out.yesterday = null;
    out.pushId = typeof raw.pushId === 'string' && isValidId(raw.pushId) && raw.pushId.length <= 64 ? raw.pushId : null;
    out.standalone = raw.standalone === true ? true : raw.standalone === false ? false : null;
    out.sharing = raw.sharing !== false;
    out.nudges = raw.nudges === true ? true : raw.nudges === false ? false : null;
    return { ok: true, status: out };
  }

  // ── Payload codec ─────────────────────────────────────────────────────────

  var PREFIXES = { setup: 'BMNEW', plan: 'BMPLAN', report: 'BMREPORT', ask: 'BMASK', intake: 'BMINTAKE' };

  // is.gd rejects a long URL past about 5,000 characters and TinyURL is no
  // more generous. A 40-item plan sits close enough to matter, so the trainer
  // app warns before it tries to shorten.
  var SHARE_LIMITS = { maxUrl: 5000, warnUrl: 4500 };

  function shareUrlLength(baseUrl, code) {
    return String(baseUrl).length + '#import='.length + String(code).length;
  }

  /* iPhone only: a plan opened from a tapped link lands in Safari, and the
     home-screen app has its own storage, so the plan must be pasted there
     once. Doing the welcome in Safari first would mean answering it twice
     and recording two consents, so a fresh phone is sent to install before
     the welcome starts. A client who has already answered the welcome, or
     who has ticked anything, is left alone: stranding someone mid-program
     would cost them their history, which lives in the browser they used.
     An intake link counts the same as a plan (first-client path, 4a): the
     install happens once, up front, and the form is answered in the app. */
  function needsInstallFirst(o) {
    o = o || {};
    return !!(o.ios && !o.standalone && (o.hasPlan || o.intakeLink) && !o.welcomeDone && !o.hasHistory && !o.skipped);
  }

  /* The welcome answered before the intake is held on the phone until the
     plan arrives (first-client path, 4b). It stands only for the person who
     answered it: the same intake link, or the plan of the same client id,
     under the wording in force, within the life of an intake link. Anything
     else asks again: a phone or browser can be shared, and consent is the
     record that matters (CTO, 2026-09-23). */
  var HELD_WELCOME_DAYS = 90;

  function welcomeStamp() {
    return WELCOME.version + '|' + CONSENTS[1].version + '|' + CONSENTS[2].version;
  }

  function heldWelcomeFits(held, o) {
    o = o || {};
    if (!held || typeof held !== 'object' || held.stamp !== welcomeStamp()) return false;
    var age = daysSince(held.at, o.today);
    if (age === null || age < 0 || age > HELD_WELCOME_DAYS) return false;
    if (o.intakeToken) return held.intakeToken === o.intakeToken;
    if (o.clientId) return !!held.clientId && held.clientId === o.clientId;
    return false;
  }

  /* Only real Safari on an iPhone can add an app to the home screen, and only
     Safari has the buttons the install screen draws. Chrome and Firefox on
     iOS, and the browsers inside Instagram, Gmail and the rest, are iPhones
     by user agent and cannot follow a word of it, so they are never sent
     there. `standaloneFlag` is whether navigator.standalone exists at all,
     which the in-app web views generally lack. */
  function iosSafari(ua, standaloneFlag) {
    var s = String(ua || '');
    if (!/iPad|iPhone|iPod/.test(s)) return false;
    if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp/i.test(s)) return false;
    return standaloneFlag !== false;
  }

  /* Anything a client has done in this browser: ticks, agreed goals, a weigh
     in, a word with the coach. Any of it means their history lives here, so
     they are never sent away from it (needsInstallFirst). Wider than the log
     alone, because the welcome version moves and a client who has only
     weighed in would otherwise be treated as brand new. */
  function hasAppHistory(state) {
    if (!state || typeof state !== 'object') return false;
    var some = function (o) { return !!o && typeof o === 'object' && Object.keys(o).length > 0; };
    return some(state.log) || some(state.weightLog) || !!state.goalsAgreedAt ||
      (Array.isArray(state.coachLog) && state.coachLog.length > 0);
  }

  // What a pasted message holds: a long link's code, or a short link's slug.
  // On iPhone the home-screen app cannot receive a tapped link (links open
  // in Safari, whose storage it does not share), so the client pastes the
  // text they were sent and the app takes it from there. Whole messages are
  // fine; the longer match wins when both are present.
  function linkFromText(text) {
    var t = String(text || '');
    // An intake link, pasted into the home-screen app after Safari opened it
    // (the same iPhone limit the plan link has). The token is spent on send.
    var i = /[#&]intake=(bmi_[0-9a-f]{36})/.exec(t);
    if (i) return { intake: i[1] };
    var m = /[#&]import=([^\s&"'<>]+)/.exec(t);
    if (m) {
      var code = m[1];
      try { code = decodeURIComponent(code); } catch (e) { /* as pasted */ }
      return { code: code };
    }
    var s = /\/p\/([A-Za-z0-9]+)/.exec(t);   // the server's slug alphabet, any case
    if (s) return { slug: s[1].toLowerCase() };
    var bare = extractCode(t);
    var known = Object.keys(PREFIXES).some(function (k) { return bare.indexOf(PREFIXES[k]) === 0; });
    return known ? { code: bare } : null;
  }

  // ── Wire format ───────────────────────────────────────────────────────────
  // Items travel with one-letter keys and indexed enums. This is 28% smaller
  // after compression, which is the difference between a 40-item plan fitting
  // through a URL shortener and not. Nothing outside this section sees the
  // compact shape: pack on the way out, unpack on the way in.

  function packItem(it) {
    var o = {
      i: it.id,
      n: it.name,
      k: KINDS.indexOf(it.kind),
      f: FREQS.indexOf(it.freq),
      a: it.addedAt,
      // Always written. `core` defaults differ by kind, so omitting a false
      // value would let an explicitly non-core habit come back gating.
      c: it.core ? 1 : 0
    };
    if (it.group) o.g = it.group;
    if (it.days && it.days.length) o.d = it.days;
    if (it.timesPerWeek) o.t = it.timesPerWeek;
    if (it.dueBy) o.u = it.dueBy;
    if (it.goalId) o.G = it.goalId;
    if (it.notes) o.o = it.notes;
    if (it.trainerNotes) o.r = it.trainerNotes;
    if (it.detail && Object.keys(it.detail).length) o.x = it.detail;
    return o;
  }

  function unpackItem(o) {
    if (!o || typeof o !== 'object') return null;
    // Tolerate an already-expanded item, so a hand-written draft still loads.
    if (o.name !== undefined || o.kind !== undefined) return o;
    return {
      id: o.i, name: o.n,
      kind: KINDS[o.k] || 'habit',
      freq: FREQS[o.f] || 'daily',
      addedAt: o.a,
      core: o.c === 1,
      group: o.g || '',
      days: o.d || [],
      timesPerWeek: o.t || 0,
      dueBy: o.u || '',
      goalId: o.G || '',
      notes: o.o || '',
      trainerNotes: o.r || '',
      detail: o.x || {}
    };
  }

  function lz() {
    return (typeof LZString !== 'undefined') ? LZString
         : (typeof global === 'object' && global.LZString) ? global.LZString
         : null;
  }

  function b64encode(s) {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
    return Buffer.from(s, 'utf8').toString('base64');
  }

  function b64decode(s) {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
    return Buffer.from(s, 'base64').toString('utf8');
  }

  function encodePayload(kind, data) {
    var prefix = PREFIXES[kind];
    if (!prefix) throw new Error('Unknown payload kind: ' + kind);
    var wire = Object.assign({ v: PAYLOAD_VERSION }, data);
    if (Array.isArray(wire.items)) wire.items = wire.items.map(packItem);
    var body = JSON.stringify(wire);
    var L = lz();
    if (L && L.compressToEncodedURIComponent) {
      return prefix + 'Z:' + L.compressToEncodedURIComponent(body);
    }
    return prefix + ':' + b64encode(body);
  }

  // Clients paste whole text messages, not bare codes. This pulls the code out
  // of surrounding prose so the trainer never has to tell anyone to trim it.
  function extractCode(text) {
    var t = String(text || '').trim();
    var best = null;
    Object.keys(PREFIXES).forEach(function (k) {
      // Built from PREFIXES, so a new payload kind is picked up here for free.
      var re = new RegExp(PREFIXES[k] + 'Z?:[^\\s]+');
      var m = re.exec(t);
      if (m && (!best || m[0].length > best.length)) best = m[0];
    });
    return best || t;
  }

  function decodePayload(code) {
    var s = String(code || '').trim();
    var kinds = Object.keys(PREFIXES);
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i], p = PREFIXES[k];
      var compressed = s.indexOf(p + 'Z:') === 0;
      var plain = s.indexOf(p + ':') === 0;
      if (!compressed && !plain) continue;

      var raw = s.slice((compressed ? p + 'Z:' : p + ':').length);
      var json;
      try {
        if (compressed) {
          var L = lz();
          if (!L) throw new Error('LZString unavailable');
          json = L.decompressFromEncodedURIComponent(raw);
        } else {
          json = b64decode(raw);
        }
      } catch (e) {
        return { ok: false, error: 'That link is damaged. Ask for a new one.' };
      }
      if (!json) return { ok: false, error: 'That link is damaged. Ask for a new one.' };

      var data;
      try { data = JSON.parse(json); }
      catch (e) { return { ok: false, error: 'That link is damaged. Ask for a new one.' }; }

      if (Number(data.v) > PAYLOAD_VERSION) {
        return { ok: false, error: 'That link needs a newer version of Beast Mode. Reload the app and try again.' };
      }
      if (Array.isArray(data.items)) {
        data.items = normalizeItems(data.items.map(unpackItem).filter(Boolean));
      }
      if (data.goals !== undefined) data.goals = normalizeGoals(data.goals);
      return { ok: true, kind: k, data: data };
    }
    return { ok: false, error: 'That does not look like a Beast Mode link.' };
  }

  // ── Trainer backup ────────────────────────────────────────────────────────
  // The dashboard is the only copy of every client, plan, intake and report.
  // A client can always be re-sent a link; the trainer has no such fallback,
  // so the roster gets a file.

  var BACKUP_TYPE = 'beast-mode-trainer-backup';

  function buildBackup(db, coreVersion) {
    return {
      type: BACKUP_TYPE,
      v: PAYLOAD_VERSION,
      core: coreVersion || VERSION,
      exportedAt: new Date().toISOString(),
      clients: (db && db.clients) || []
    };
  }

  function backupFilename(now) {
    return 'beast-mode-backup-' + dateToLocal(now || new Date()) + '.json';
  }

  // Strict, because the thing on the other side of a bad restore is every
  // client Chris has.
  function readBackup(text) {
    var data;
    try { data = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'That file is not a Beast Mode backup.' };
    }
    if (data.type !== BACKUP_TYPE) {
      return { ok: false, error: 'That is not a trainer backup. Trainer backups start with "' + BACKUP_TYPE + '".' };
    }
    if (Number(data.v) > PAYLOAD_VERSION) {
      return { ok: false, error: 'That backup was made by a newer version of Beast Mode.' };
    }
    if (!Array.isArray(data.clients)) {
      return { ok: false, error: 'That backup has no client list.' };
    }

    var clients = data.clients.map(function (c) {
      return Object.assign({}, c, {
        id: isValidId(c && c.id) ? c.id : newId(),
        name: c && c.name ? String(c.name) : 'Unnamed',
        items: normalizeItems(c && c.items),
        goals: normalizeGoals(c && c.goals),
        profile: (c && c.profile) || {},
        reports: (c && c.reports) || {}
      });
    });

    return { ok: true, clients: clients, exportedAt: data.exportedAt || null, core: data.core || null };
  }

  // What a restore would do, worked out before anything is written.
  function backupDiff(current, incoming) {
    var byId = {};
    (current || []).forEach(function (c) { byId[c.id] = c; });
    var add = [], overlap = [];
    (incoming || []).forEach(function (c) {
      (byId[c.id] ? overlap : add).push(c.name);
    });
    var onlyHere = (current || []).filter(function (c) {
      return !(incoming || []).some(function (i) { return i.id === c.id; });
    }).map(function (c) { return c.name; });
    return { add: add, overlap: overlap, onlyHere: onlyHere };
  }

  function daysSince(iso, today) {
    if (!iso) return null;
    var d = localDateOf(iso);
    return d ? daysBetween(d, today || todayLocal()) : null;
  }

  // ── Reminders ─────────────────────────────────────────────────────────────
  // The server is told only which clock times to ping a phone at. Which items
  // are due, and their names, are worked out on the device when the push
  // arrives, so no plan data has to leave it.

  // Distinct dueBy times across a plan, earliest first.
  function reminderSlots(items) {
    var seen = {};
    (items || []).forEach(function (it) {
      if (it.dueBy && minutesOfDay(it.dueBy) !== null) seen[it.dueBy] = true;
    });
    return Object.keys(seen).sort();
  }

  // What is still outstanding at a given slot on a given date. Anything already
  // done is left out, so a client who finished early is not nagged.
  function dueAtSlot(items, log, ymd, slot) {
    return (items || []).filter(function (it) {
      if (it.dueBy !== slot) return false;
      if (!isAvailable(it, ymd)) return false;
      return !isDone(log, it.id, ymd);
    });
  }

  // "Zone 2 and 2 more, due by 8am" / "Zone 2, due by 8am"
  function reminderText(due, slot) {
    if (!due.length) return '';
    var head = due[0].name;
    var rest = due.length - 1;
    return head + (rest ? ' and ' + rest + ' more' : '') +
      (slot ? ', due by ' + formatDueBy(slot) : '');
  }

  // Quiet hours may wrap past midnight, so the comparison is split rather than
  // a single range check.
  function inQuietHours(hhmm, quiet) {
    if (!quiet || !quiet.from || !quiet.to) return false;
    var t = minutesOfDay(hhmm), a = minutesOfDay(quiet.from), b = minutesOfDay(quiet.to);
    if (t === null || a === null || b === null) return false;
    return a <= b ? (t >= a && t < b) : (t >= a || t < b);
  }

  // ── Daily report ──────────────────────────────────────────────────────────
  // One day, sent back to the trainer. Only that day's entries travel, so a
  // report stays small enough for SMS however long the client has been going.

  function buildReport(items, log, date, opts) {
    opts = opts || {};
    var day = dayResult(items, log, date);
    var due = items.filter(function (it) { return isAvailable(it, date); });

    var entries = {};
    var onTime = 0, done = 0;
    due.forEach(function (it) {
      var e = entryFor(log, it.id, date);
      if (!e || !e.done) return;
      done++;
      if (isOnTime(it, e, date)) onTime++;
      entries[it.id] = { n: it.name, t: e.completedAt || null };
    });

    return {
      date: date,
      name: opts.name || '',
      gratitude: String(opts.gratitude || '').trim(),
      entries: entries,
      stats: {
        scheduled: due.length,
        done: done,
        onTime: onTime,
        core: day.scheduledCore,
        gate: day.gate,
        dayPoints: day.points,
        points: opts.points != null ? opts.points : totalPoints(items, log, date),
        streak: opts.streak != null ? opts.streak : currentStreak(items, log, addDays(date, 1)),
        rank: opts.rank || ''
      }
    };
  }

  // Percentages for the trainer's history view. Guards the empty day, since a
  // rest day with nothing scheduled is 100% rather than a divide by zero.
  function reportSummary(r) {
    var s = r.stats || {};
    var pct = function (n, d) { return d ? Math.round((n / d) * 100) : 100; };
    return {
      date: r.date,
      completion: pct(s.done, s.scheduled),
      onTime: pct(s.onTime, s.done),
      done: s.done,
      scheduled: s.scheduled,
      gate: s.gate,
      points: s.points,
      dayPoints: s.dayPoints,
      streak: s.streak,
      rank: s.rank,
      gratitude: r.gratitude || ''
    };
  }

  // ── Intake ────────────────────────────────────────────────────────────────
  // The field list is the one brofessor-project-instructions.md tells the coach
  // to ask for before writing a plan, so a finished intake pastes into the
  // Project with no gaps left for Chris to fill by hand.

  // Beast Mode is for adults only (learning plan D8). The intake is the one
  // way a new client arrives, so it is where an under-18 is turned away.
  var MIN_AGE = 18;

  // Whole years between a 'YYYY-MM-DD' birthday and today, or null when the
  // birthday is missing or not a real date.
  function ageOn(birthday, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday || '').trim());
    if (!m) return null;
    var t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today || todayLocal());
    var years = Number(t[1]) - Number(m[1]);
    if (t[2] + t[3] < m[2] + m[3]) years--;   // birthday not reached yet this year
    return years >= 0 ? years : null;
  }

  // True when either the stated age or the birthday says under MIN_AGE. A blank
  // answer is not a block: Chris sees the intake before any plan is made.
  function isUnderAge(answers, today) {
    var a = answers || {};
    var stated = (a.age === '' || a.age == null) ? null : Number(a.age);
    if (stated !== null && !isNaN(stated) && stated < MIN_AGE) return true;
    var fromBirthday = ageOn(a.birthday, today);
    return fromBirthday !== null && fromBirthday < MIN_AGE;
  }

  // The intake's own version (loop brief 5b). Version 1 asked "Your day" in
  // three fields (wakeTime, workHours, bedTime). Version 2 asks for the
  // client's real routine, a work day and a day off, so the plan places each
  // new habit into the day they actually have. Everything that reads answers
  // takes both shapes: existing clients answered version 1.
  var INTAKE_VERSION = 2;

  // Version 1's keys that are gone, kept so old answers still print (under
  // the section named) and still make a baseline. Never asked again.
  // (workHours kept its key.)
  var INTAKE_LEGACY = {
    wakeTime: { label: 'Usual wake time', section: 'Your work day', replaces: 'workWake' },
    bedTime: { label: 'Usual bed time', section: 'Your work day', replaces: 'workBed' },
    ancillaries: { label: 'Anything prescribed', section: 'Health' },
    // Version 2's test-prep screen, folded into Goals as one question (Chris, 2026-09-23).
    testEvents: { label: 'Test events', section: 'Goals' },
    testDate: { label: 'Test date', section: 'Goals' },
    testScores: { label: 'Current test scores', section: 'Goals' },
    testVenue: { label: 'Where the test is', section: 'Goals' },
    age: { label: 'Age', section: 'Personal Info' },
    // Version 2's two goal lists, one list since 2026-09-23.
    shortGoals: { label: 'Next 4 weeks', section: 'Goals' },
    longGoals: { label: 'Next 6 to 12 months', section: 'Goals' },
    bulkStyle: { label: 'If bulking: lean, or not fussy', section: 'Goals' },
    // Asked as "Any side effects? If so, what?" now.
    ancPrescriber: { label: 'Who prescribes it, and the next follow-up', section: 'Your prescription' }
  };

  // The routine questions asked for both a work day and a day off. `hint`
  // doubles as the example the client sees. Each key is prefixed by the pass.
  var ROUTINE_ASKS = [
    { key: 'wake', label: 'Wake time, and the first thing you do', type: 'text', hint: '5:30, coffee and my phone' },
    { key: 'meals', label: 'When you eat, roughly, and where', type: 'textarea', hint: '7 at home, 12 at my desk, 6:30 at home. Takeout twice a week' },
    { key: 'train', label: 'When you could train, and a second choice', type: 'text', hint: '5:30 pm after work, or 6 am' },
    { key: 'evening', label: 'The evening, hour by hour, in a few words', type: 'textarea', hint: '6 dinner, 7 kids, 8 TV and a couple of beers, 10 phone in bed' },
    { key: 'bed', label: 'Bed time, and how long to fall asleep', type: 'text', hint: '10:30, about 20 minutes' }
  ];

  function routinePass(prefix) {
    var out = [];
    ROUTINE_ASKS.forEach(function (f, i) {
      out.push({ key: prefix + f.key[0].toUpperCase() + f.key.slice(1), label: f.label, type: f.type, hint: f.hint, ask: f.key });
      // The work day alone has fixed blocks to place around.
      if (i === 0 && prefix === 'work') {
        out.push({ key: 'workHours', label: 'Leave for work, work start and end, commute', type: 'text',
                   hint: '7:15, 8 to 5, 30 minutes each way', ask: 'hours' });
      }
    });
    return out;
  }

  var INTAKE_SECTIONS = [
    // Chris's wording, 2026-09-23. Pounds and inches throughout; the date
    // of birth is a date field (the phone's own picker, stored YYYY-MM-DD,
    // which the adults-only check reads); sex is two buttons, not a list.
    { title: 'Personal Info', hint: 'We base our calculations from this data so be as accurate as possible.', fields: [
      { key: 'firstName', label: 'First name', type: 'text' },
      { key: 'lastName', label: 'Last name', type: 'text' },
      { key: 'birthday', label: 'Date of birth', type: 'date' },
      { key: 'sex', label: 'Sex', type: 'choice', options: ['male', 'female'] },
      { key: 'height', label: 'Height (inches)', type: 'number', hint: '71' },
      { key: 'weight', label: 'Current weight (lb)', type: 'number', hint: '196' },
      { key: 'goalWeight', label: 'Goal weight (lb)', type: 'number', hint: '185' },
      { key: 'waist', label: 'Waist (inches)', type: 'number', hint: '38, at the navel, relaxed' },
      { key: 'bodyFat', label: 'Body fat %, if you know', type: 'number', hint: '22' },
      { key: 'maxHr', label: 'Max heart rate, if you know', type: 'number', hint: '180' },
      { key: 'household', label: 'Who’s at home?', type: 'select',
        options: ['on my own', 'with a partner', 'partner and kids', 'kids', 'roommates or family'] }
    ] },
    // The page that matters most (Chris, 2026-09-23): second, while attention
    // is fresh, in its own look, and first on the summary. `lead` is The
    // Brofessor's line above the questions; Chris's wording to come.
    { title: 'Goals', featured: true,
      // Chris's wording, 2026-09-23.
      hint: 'What do you want to change? One goal per line. Big, small, and anything in between. ' +
        'Put a time frame on any goal that has one. If it’s open ended that’s fine too, The Brofessor will turn even the biggest goals into manageable pieces.',
      lead: 'A goal without a plan is just a wish.',
      // The heading in full, one line, in the display font (Chris, 2026-09-23).
      heading: 'Goals - Why we are here so make them good.',
      fields: [
      // One list (Chris, 2026-09-23); the plan sorts each goal by its own
      // time frame (goalsFromIntake), and old shortGoals/longGoals still read.
      { key: 'goals', label: 'Your goals', type: 'textarea',
        hint: 'Lose 10 lb before vacation in 3 months\nWalk every morning\nDeadlift my body weight by spring' },
      { key: 'whyNow', label: 'Why is now the right time?', type: 'textarea', hint: 'Turned 41; blood pressure is up; a wedding in June; tired of being tired' },
      { key: 'obstacle', label: 'What has stopped you before?', type: 'textarea', hint: 'Travel weeks; lost interest after a month; late-night snacking; no plan' },
      { key: 'dietsTried', label: 'Diets you’ve tried, and what happened', type: 'textarea', hint: 'Keto twice, lost 15 then it came back; never really tried one' },
      // The keys keep their names: the coach and the dashboard read them as
      // what the client likes most and least about their day.
      { key: 'habitKeep', label: 'What do you like most about your day?', type: 'text', hint: 'The morning walk; dinner with the kids; the drive home with music up' },
      { key: 'habitBreak', label: 'What do you like least about your day?', type: 'text', hint: 'The 3 pm slump; beers on the couch; phone in bed' },
      { key: 'testComing', label: 'Any fitness tests coming up? Which, and when', type: 'text',
        hint: 'Police academy, military PT test, a race. Write none if none' },
      { key: 'otherGoals', label: 'Any goals that aren’t fitness related?', type: 'textarea',
        hint: 'Sleep through the night; read more; less time on my phone; get the promotion' }
    ] },
    // The routine sections carry `routine: true`: they are the baseline, and
    // the ones asked again when a new plan block arrives (brief 5d).
    { title: 'Your work day', routine: true, pass: 'work',
      hint: 'What does your normal work day look like? More info is better than less but we don’t need every minute accounted for.',
      fields: [
        { key: 'job', label: 'What do you do all day?', type: 'text', hint: 'Desk job, on your feet, trades' },
        { key: 'activity', label: 'How active is that?', type: 'select',
          options: ['mostly sitting', 'up and down', 'on my feet all day', 'physical work'] }
      ].concat(routinePass('work'), [
        { key: 'workCooks', label: 'Who cooks, and whose schedule runs your evening?', type: 'text',
          hint: 'I do; my wife; we split it; the kids’ schedule runs it' }
      ]) },
    { title: 'Your day off', routine: true, pass: 'off',
      hint: 'Same again for a day off. Weekends (or days off) are where most plans go sideways.',
      fields: routinePass('off') },
    { title: 'Typical Day', routine: true, pass: 'most',
      hint: 'What do you consume and how active are you on an average day? If a work day and a day off are different, give both.',
      fields: [
        { key: 'steps', label: 'Steps on a normal day, if you know', type: 'text', hint: '8,000 on a work day, 4,000 on a day off' },
        { key: 'water', label: 'Water on a normal day', type: 'text', hint: '3 glasses, or one big bottle' },
        { key: 'alcohol', label: 'Alcohol in a normal week', type: 'text', hint: '3 beers Friday, 4 Saturday' },
        { key: 'caffeine', label: 'Caffeine on a normal day', type: 'text', hint: '2 coffees, the last one around 2' },
        { key: 'calories', label: 'Total calories on a normal day, if you know', type: 'text', hint: 'About 2,500. Skip it if you have no idea' },
        { key: 'awayNights', label: 'Nights away from home in a normal month', type: 'text',
          hint: '2 nights for work, or none' },
        // A Brotocol in waiting (Chris, 2026-09-23).
        { key: 'teeth', label: 'How often do you brush and floss?', type: 'text',
          hint: 'Brush twice a day, floss when I remember' }
      ] },
    // Chris's wording, 2026-09-23.
    { title: 'Training', hint: 'Where and when do you currently workout? What are you willing to add?', fields: [
      { key: 'experience', label: 'Training experience', type: 'select',
        options: ['never really trained', 'on and off', 'a year or two', 'years of it'] },
      { key: 'currentTraining', label: 'What are you doing for exercise now, if anything?', type: 'textarea',
        hint: 'Gym twice a week, mostly machines; walking the dog; nothing for a year' },
      { key: 'gym', label: 'Which gym, and how far from home or work?', type: 'text', hint: 'Planet Fitness, 10 minutes from work; none' },
      { key: 'daysPerWeek', label: 'Days a week you can train', type: 'number', hint: '4' },
      { key: 'sessionLength', label: 'Minutes per session', type: 'number', hint: '45' },
      { key: 'equipment', label: 'What equipment do you have access to?', type: 'textarea',
        hint: 'Full gym, home rack, dumbbells, bands' },
      { key: 'sports', label: 'Sports you play, and how often', type: 'text', hint: 'Pickup basketball on Tuesdays, golf most Saturdays' },
      { key: 'hobbies', label: 'Hobbies that take up evenings or weekends', type: 'text', hint: 'Fishing, gaming, the kids’ games' }
    ] },
    // Chris's wording, 2026-09-23: Rule One, from the methods file.
    { title: 'Health', hint: 'Rule #1 - Don’t get hurt. Rule #2 - See rule #1.', fields: [
      { key: 'injuries', label: 'Injuries or anything that hurts', type: 'textarea', hint: 'Left knee, sore going downstairs; lower back after long drives; none' },
      { key: 'conditions', label: 'Medical conditions', type: 'textarea', hint: 'High blood pressure, on medication; pre-diabetic; none' },
      { key: 'allergies', label: 'Food allergies', type: 'text', hint: 'Shellfish; none' },
      { key: 'foodsAvoided', label: 'Foods you will not eat', type: 'textarea', hint: 'Mushrooms, fish, anything spicy' },
      { key: 'supplements', label: 'Supplements you take now', type: 'textarea', hint: 'Creatine 5 g daily, fish oil, a multivitamin' },
      { key: 'supplementsOpen', label: 'Willing to add supplements if the plan calls for them?', type: 'yesno' },
      { key: 'sleep', label: 'How do you sleep?', type: 'textarea',
        hint: 'About 6 hours, up once or twice; solid 8; badly, and I wake up tired' },
      { key: 'stress', label: 'How stressed are you, and what by?', type: 'textarea',
        hint: 'Pretty high, work and the kids; low, life is good' },
      { key: 'ancillariesYes', label: 'Are you on anything prescribed?', type: 'yesno',
        hint: 'GLP-1, TRT, thyroid, blood pressure. This stays between you and me.' }
    ] },
    // Shown only after a yes above: what the ancillary rules need (methods
    // section 6b), so nothing has to be asked again by text.
    { title: 'Your prescription', when: { key: 'ancillariesYes', is: 'yes' },
      hint: 'We will never recommend changes to meds. We need to know so your plan works around it.',
      fields: [
        { key: 'ancName', label: 'What is it?', type: 'text', hint: 'Semaglutide, testosterone cypionate, levothyroxine' },
        { key: 'ancDose', label: 'Dose', type: 'text' },
        { key: 'ancSchedule', label: 'When you take it', type: 'text', hint: 'Sunday mornings; every day with breakfast' },
        { key: 'ancSince', label: 'How long you’ve been on it', type: 'text' },
        { key: 'ancSideEffectsYes', label: 'Any side effects?', type: 'yesno' },
        { key: 'ancSideEffects', label: 'What are they?', type: 'textarea', when: { key: 'ancSideEffectsYes', is: 'yes' } }
      ] },
    // Everything The Brofessor puts in a client's hands (methods 4b, 4c, 6c).
    // Each tool is a yes or no, and the detail appears only after a yes.
    { title: 'Tools', hint: 'These are items we use. None of it is required to start.', fields: [
      { key: 'foodAppYes', label: 'Do you use a food-tracking app?', type: 'yesno',
        hint: 'MyFitnessPal is what I use with clients. Logging food is part of the process.' },
      { key: 'foodApp', label: 'Which one?', type: 'select', options: ['MyFitnessPal', 'another app'], when: { key: 'foodAppYes', is: 'yes' } },
      { key: 'scale', label: 'A scale at home?', type: 'yesno' },
      { key: 'treadmillYes', label: 'Do you have a treadmill you can use?', type: 'yesno', hint: 'One at home is ideal for Zone 2.' },
      { key: 'treadmill', label: 'Where?', type: 'select', options: ['at home', 'at the gym'], when: { key: 'treadmillYes', is: 'yes' } },
      { key: 'hrMonitor', label: 'A heart-rate monitor?', type: 'yesno', hint: 'A watch or a chest strap.' },
      { key: 'bandsYes', label: 'Exercise bands?', type: 'yesno', hint: 'The warm-up runs on them.' },
      { key: 'bands', label: 'Which?', type: 'select', options: ['mini loop bands', 'a long band or tube with handles', 'both'],
        when: { key: 'bandsYes', is: 'yes' } },
      { key: 'bodyToolsYes', label: 'Any body work tools?', type: 'yesno', hint: 'The Stick, a Theragun or Hypervolt, a foam roller, a lacrosse ball' },
      { key: 'bodyTools', label: 'Which ones?', type: 'textarea', when: { key: 'bodyToolsYes', is: 'yes' } },
      { key: 'toolsOpen', label: 'Willing to buy tools if the plan calls for them?', type: 'yesno',
        hint: 'Bands and a lacrosse ball are cheap. Nothing is required to start.' }
    ] },
    { title: 'Music', hint: 'The Brofessor can make music suggestions for your sessions.', fields: [
      // Chris's wording, 2026-09-23.
      { key: 'musicService', label: 'What music service do you use?', type: 'select',
        options: ['Spotify', 'Apple Music', 'Amazon Music', 'something else', 'I raw dog training'] },
      // "I raw dog training" means no music: the rest of the page steps aside.
      { key: 'musicType', label: 'What do you train to?', type: 'text', hint: 'Metal, hip hop, country, whatever gets you going',
        unless: { key: 'musicService', is: 'I raw dog training' } },
      { key: 'bandsMusic', label: 'Bands or artists', type: 'textarea', hint: 'Metallica, Pantera, Rage',
        unless: { key: 'musicService', is: 'I raw dog training' } },
      { key: 'songs', label: 'Songs', type: 'textarea', hint: 'Enter Sandman, Walk, Bulls on Parade',
        unless: { key: 'musicService', is: 'I raw dog training' } },
      { key: 'cleanOnly', label: 'Clean versions only?', type: 'yesno',
        unless: { key: 'musicService', is: 'I raw dog training' } }
    ] }
  ];

  function intakeFields() {
    return INTAKE_SECTIONS.reduce(function (all, s) { return all.concat(s.fields); }, []);
  }

  // The routine sections alone: the short form asked again when a new plan
  // block arrives, and the part of the intake the baseline is read from.
  function routineSections() {
    return INTAKE_SECTIONS.filter(function (s) { return s.routine; });
  }

  var blank = function (v) { return v === undefined || v === null || String(v).trim() === ''; };
  var clean = function (v) { return blank(v) ? '' : String(v).trim().replace(/\s*\n+\s*/g, '; '); };

  // Which version a set of answers was given to, when the record does not
  // say: version 1 answers carry a legacy key and none of the new routine
  // keys. Nothing answered at all is the current version.
  function intakeVersionOf(answers) {
    var a = answers || {};
    var asked = function (keys) { return keys.some(function (k) { return !blank(a[k]); }); };
    var newKeys = routineSections().reduce(function (all, s) {
      return all.concat(s.fields.map(function (f) { return f.key; }));
    }, []).filter(function (k) { return k !== 'job' && k !== 'activity' && k !== 'workHours'; });
    if (asked(newKeys)) return INTAKE_VERSION;
    return asked(['wakeTime', 'bedTime']) ? 1 : INTAKE_VERSION;
  }

  // Plain text block for the coach: what Chris pastes into the Claude
  // Project, and the same words the app coach reads. Version 1 answers print
  // their routine lines under the old heading, since the new sections would
  // show them nothing.
  function formatIntakeForCoach(name, answers) {
    var a = visibleAnswers(answers);
    var v = intakeVersionOf(a);
    var out = ['INTAKE: ' + (name || 'new client'), ''];
    visibleSections(a).forEach(function (sec) {
      var fields = visibleFields(sec, a);
      if (v === 1 && sec.routine) {
        if (sec.pass !== 'work') return;
        // The three old lines, plus job and activity, under the old title.
        // workHours kept its key; only its label moved.
        var legacy = [{ key: 'job', label: 'What do you do all day?' }, { key: 'activity', label: 'How active is that?' },
          { key: 'wakeTime', label: INTAKE_LEGACY.wakeTime.label }, { key: 'workHours', label: 'Work hours' }, { key: 'bedTime', label: INTAKE_LEGACY.bedTime.label }];
        var old = legacy.filter(function (f) { return !blank(a[f.key]); })
          .map(function (f) { return f.label + ': ' + clean(a[f.key]); });
        if (old.length) { out.push('YOUR DAY'); out = out.concat(old); out.push(''); }
        return;
      }
      var lines = fields.filter(function (f) { return !blank(a[f.key]); })
        .map(function (f) { return f.label + ': ' + clean(a[f.key]); });
      // A gone key prints under its section: always for a section that no
      // longer asks it, and for a routine section only where the new key
      // it replaces was left blank (a version-1 bed time under a re-answer).
      Object.keys(INTAKE_LEGACY).forEach(function (k) {
        var L = INTAKE_LEGACY[k];
        if (L.section !== sec.title || blank(a[k])) return;
        if (sec.routine && !(L.replaces && blank(a[L.replaces]))) return;
        lines.push(L.label + ': ' + clean(a[k]));
      });
      if (!lines.length) return;
      out.push(sec.title.toUpperCase());
      out = out.concat(lines);
      out.push('');
    });
    return out.join('\n').trim();
  }

  // The answers that stand: anything under a section or field the client's
  // other answers hide (a prescription after a No, songs after "I raw dog
  // training") is dropped, so what is stored, printed and read by the coach
  // is what the client saw on the summary. Typed text behind a flipped
  // button is kept on the phone until they send.
  function visibleAnswers(answers) {
    var a = answers || {};
    var keep = {};
    Object.keys(INTAKE_LEGACY).forEach(function (k) { if (!blank(a[k])) keep[k] = a[k]; });
    visibleSections(a).forEach(function (sec) {
      visibleFields(sec, a).forEach(function (f) { if (!blank(a[f.key])) keep[f.key] = a[f.key]; });
    });
    return keep;
  }

  // The yes and no a two-button question stores. The app draws the buttons
  // from this, and every `when` clause compares against it.
  var YESNO = ['yes', 'no'];

  // The sections a client sees, given their answers so far: a conditional
  // section (`when`) appears only once its question is answered that way.
  function visibleSections(answers, sections) {
    var a = answers || {};
    return (sections || INTAKE_SECTIONS).filter(function (s) { return !s.when || a[s.when.key] === s.when.is; });
  }

  // The fields of a section a client sees now: a `when` field appears only
  // once its question is answered that way, and an `unless` field goes away
  // when it is. A yes/no field's options are always yes and no.
  function visibleFields(section, answers) {
    var a = answers || {};
    return section.fields.filter(function (f) {
      if (f.when && a[f.when.key] !== f.when.is) return false;
      if (f.unless && a[f.unless.key] === f.unless.is) return false;
      return true;
    });
  }

  /* The baseline: the client's routine as one object, from either version of
     the answers. Every field is a trimmed string, '' when unanswered, so a
     reader never checks for undefined. `empty` is true when nothing about the
     routine was answered. Version 1 answers fill the work day's wake, hours
     and bed and nothing else. */
  function routineBaseline(answers) {
    var a = visibleAnswers(answers);
    var v = intakeVersionOf(a);
    var pick = function (key, legacy) { return clean(!blank(a[key]) ? a[key] : (legacy ? a[legacy] : '')); };
    var b = {
      version: v,
      job: pick('job'), activity: pick('activity'),
      work: { wake: pick('workWake', 'wakeTime'), hours: pick('workHours'), meals: pick('workMeals'),
              train: pick('workTrain'), evening: pick('workEvening'), bed: pick('workBed', 'bedTime') },
      off: { wake: pick('offWake'), meals: pick('offMeals'), train: pick('offTrain'),
             evening: pick('offEvening'), bed: pick('offBed') },
      most: { steps: pick('steps'), water: pick('water'), alcohol: pick('alcohol'), caffeine: pick('caffeine') },
      habitKeep: pick('habitKeep'), habitBreak: pick('habitBreak'), obstacle: pick('obstacle')
    };
    b.empty = ![b.work, b.off, b.most].some(function (g) {
      return Object.keys(g).some(function (k) { return g[k] !== ''; });
    });
    return b;
  }

  // A baseline as one flat object keyed by the version 2 field keys.
  function flatBaseline(b) {
    var out = { job: b.job, activity: b.activity, steps: b.most.steps, water: b.most.water, alcohol: b.most.alcohol, caffeine: b.most.caffeine };
    Object.keys(b.work).forEach(function (k) { out['work' + k[0].toUpperCase() + k.slice(1)] = b.work[k]; });
    Object.keys(b.off).forEach(function (k) { out['off' + k[0].toUpperCase() + k.slice(1)] = b.off[k]; });
    return out;
  }

  // The routine fields whose answers changed between two sets of answers:
  // [{ key, label, from, to }]. The measure of routine change (brief 5d).
  // Compared slot by slot through routineBaseline, so a first answer in the
  // old shape (wakeTime, bedTime) against a new one (workWake, workBed) is
  // not a change when the times are the same.
  function routineChanges(before, after) {
    var b = flatBaseline(routineBaseline(before)), a = flatBaseline(routineBaseline(after));
    var out = [];
    routineSections().forEach(function (sec) {
      sec.fields.forEach(function (f) {
        if (b[f.key] !== a[f.key]) out.push({ key: f.key, label: sec.title + ': ' + f.label, from: b[f.key], to: a[f.key] });
      });
    });
    return out;
  }

  /* A clock time from the start of a free-text answer, as minutes from
     midnight, or null when none can be read. Accepts '5:30', '5:30 am',
     '6pm', '17:30', '6', 'about 6', '10.30pm'. A bare hour with no am or pm
     is read the way people write it: `opts.pm` says the field is an evening
     one (bed, evening), where '6' means 18:00 and '10' means 22:00; otherwise
     '6' is 06:00. This places a block on the day strip and never changes
     what the client wrote. */
  function timeFromText(text, opts) {
    var s = String(text || '');
    if (/\bnoon\b/i.test(s)) return 720;
    if (/\bmidnight\b/i.test(s)) return 0;
    // The first number that can be a clock time. A bare number is a clock
    // hour only when it could be one: "20 minutes" and "17" are skipped;
    // "17:30" and "6pm" are read.
    var re = /(?:^|[^\d.])(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$|[,;.)])/gi;
    var m, h = null, min = 0, ap = '';
    while ((m = re.exec(s))) {
      var hh = Number(m[1]), mm = m[2] ? Number(m[2]) : 0, aa = m[3] ? m[3].replace(/\./g, '').toLowerCase() : '';
      if (!m[2] && !aa && (hh < 1 || hh > 12)) continue;
      if (hh > 24 || mm > 59) continue;
      h = hh; min = mm; ap = aa;
      break;
    }
    if (h === null) return null;
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && opts && opts.pm && h === 12) h = 0;   // "12" at bed time is midnight
    else if (!ap && opts && opts.pm && h >= 1 && h < 12) h += 12;
    if (h === 24) h = 0;
    return h * 60 + min;
  }

  // Every submission's answers as one set, newest winning, so a routine
  // answered again on its own keeps the goals, health and habits from the
  // full intake underneath it. `rows` is newest first, each { answers }.
  function mergeIntakeAnswers(rows) {
    var out = {};
    (rows || []).slice().reverse().forEach(function (r) {
      var a = r && r.answers && typeof r.answers === 'object' ? r.answers : {};
      Object.keys(a).forEach(function (k) { if (!blank(a[k])) out[k] = a[k]; });
    });
    return out;
  }

  // The routine is asked again when a new plan block arrives, and a block is
  // a change to the checklist: an item added or removed, or a due-by time
  // moved. A note edit or a re-sent link is not one. At most once a fortnight.
  var ROUTINE_AGAIN_DAYS = 14;
  function checklistChanged(before, after) {
    var key = function (it) { return it.id + '|' + (it.dueBy || ''); };
    var a = (before || []).map(key).sort().join(','), b = (after || []).map(key).sort().join(',');
    return a !== b;
  }

  // The goals a client typed become the structured goals the plan carries.
  // One list since 2026-09-23: a goal with a long time frame in its own
  // words (months beyond the first block, a year, a season, a month name)
  // is a long-term goal; anything else is the next four weeks. Chris moves
  // them on the dashboard if the guess is wrong. The old two lists still read.
  // A season or a month name counts only after a time word ("by spring",
  // "before May"), so "fall asleep faster" and "I may run a 5k" stay short.
  var LONG_WORDS = /\b(by|in|before|until|till|this|next|for|through|come)\s+(the\s+)?(year|spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(a|one|two|three|\d+)[\s-]*years?\b|\bnext year\b/i;
  function goalTerm(text) {
    var m = /(\d+)[\s-]*(month|months|mo)\b/i.exec(text);
    if (m) return Number(m[1]) >= 2 ? 'long' : 'short';
    var w = /(\d+)[\s-]*(week|weeks|wk|wks)\b/i.exec(text);
    if (w) return Number(w[1]) >= 5 ? 'long' : 'short';
    return LONG_WORDS.test(text) ? 'long' : 'short';
  }
  function goalsFromIntake(answers) {
    var a = answers || {};
    var mk = function (text, term) {
      return String(text || '').split('\n').map(function (s) { return s.trim(); })
        .filter(Boolean).map(function (t) { return { text: t, term: term || goalTerm(t) }; });
    };
    return normalizeGoals(mk(a.goals).concat(mk(a.shortGoals, 'short'), mk(a.longGoals, 'long')));
  }

  // The intake fields that belong on the client's profile from day one.
  // The name the client typed wins over the one on the link, when they gave one.
  function profileFromIntake(name, answers) {
    var typed = [answers.firstName, answers.lastName].map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' ');
    return {
      name: typed || name || '',
      height: answers.height || '',
      weight: answers.weight || '',
      goalWeight: answers.goalWeight || '',
      birthday: answers.birthday || '',
      why: answers.whyNow || ''
    };
  }

  // ── Brofessor drafts ──────────────────────────────────────────────────────
  // A draft is hand-written JSON from the coach. It is checked strictly and
  // rejected with messages naming the offending item and field, because the
  // alternative is a silently wrong plan reaching a client's phone.

  function draftLabel(raw, i) {
    var n = raw && raw.name ? String(raw.name).trim() : '';
    return n ? '"' + n + '"' : 'item ' + (i + 1);
  }

  function validateDraft(raw) {
    var errors = [];
    var parsed = raw;

    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); }
      catch (e) { return { ok: false, errors: ['That is not valid JSON. Check for a missing comma or bracket.'], items: [], goals: [] }; }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, errors: ['The draft should be a JSON object with an "items" list.'], items: [], goals: [] };
    }
    if (!Array.isArray(parsed.items) || !parsed.items.length) {
      return { ok: false, errors: ['The draft has no "items" list, or it is empty.'], items: [], goals: [] };
    }

    parsed.items.forEach(function (it, i) {
      var who = draftLabel(it, i);
      if (!it || typeof it !== 'object') { errors.push(who + ' is not an object.'); return; }
      if (!it.name || !String(it.name).trim()) errors.push('Item ' + (i + 1) + ' has no name.');

      if (it.kind !== undefined && KINDS.indexOf(it.kind) === -1) {
        errors.push(who + ': kind "' + it.kind + '" is not one of ' + KINDS.join(', ') + '.');
      }
      if (it.freq !== undefined && FREQS.indexOf(it.freq) === -1) {
        errors.push(who + ': freq "' + it.freq + '" is not one of ' + FREQS.join(', ') + '.');
      }
      if (it.dueBy && minutesOfDay(it.dueBy) === null) {
        errors.push(who + ': dueBy "' + it.dueBy + '" is not a 24-hour HH:MM time.');
      }
      if (it.days !== undefined) {
        if (!Array.isArray(it.days)) errors.push(who + ': days must be a list of 0 to 6, Monday first.');
        else it.days.forEach(function (d) {
          if (!Number.isInteger(d) || d < 0 || d > 6) errors.push(who + ': day "' + d + '" is not 0 to 6.');
        });
      }
      var d = it.detail || {};
      if (it.kind === 'exercise' && d.metric !== undefined && METRICS.indexOf(d.metric) === -1) {
        errors.push(who + ': metric "' + d.metric + '" is not one of ' + METRICS.join(', ') + '.');
      }
      if (it.kind === 'supplement' && d.timing !== undefined && TIMINGS.indexOf(d.timing) === -1) {
        errors.push(who + ': timing "' + d.timing + '" is not one of ' + TIMINGS.join(', ') + '.');
      }
      if (it.kind === 'ancillary' && d.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.followUp))) {
        errors.push(who + ': followUp "' + d.followUp + '" is not a YYYY-MM-DD date.');
      }
    });

    if (errors.length) return { ok: false, errors: errors, items: [], goals: [] };
    return {
      ok: true, errors: [],
      items: normalizeItems(parsed.items),
      goals: normalizeGoals(parsed.goals || []),
      profile: parsed.profile || {}
    };
  }

  function matchKey(name) { return String(name || '').trim().toLowerCase(); }

  // Drafts carry no ids, so incoming items are matched to what the client
  // already has by name. A matched item keeps its id and addedAt, which is
  // what makes re-importing the same draft a no-op instead of a reset that
  // wipes the client's history and streak.
  function mergeDraft(existing, incoming, today) {
    today = today || todayLocal();
    var byName = {};
    (existing || []).forEach(function (it) { byName[matchKey(it.name)] = it; });

    var added = [], kept = [], changed = [];
    var usedIds = {};

    var items = incoming.map(function (inc) {
      var prev = byName[matchKey(inc.name)];
      if (!prev) {
        added.push(inc.name);
        return normalizeItem(Object.assign({}, inc, { id: newId(), addedAt: today }));
      }
      usedIds[prev.id] = true;
      var merged = normalizeItem(Object.assign({}, inc, { id: prev.id, addedAt: prev.addedAt }));
      var diffs = ['core', 'freq', 'dueBy', 'group', 'notes', 'trainerNotes'].filter(function (f) {
        return JSON.stringify(merged[f]) !== JSON.stringify(prev[f]);
      });
      if (diffs.length || JSON.stringify(merged.detail) !== JSON.stringify(prev.detail) ||
          JSON.stringify(merged.days) !== JSON.stringify(prev.days)) {
        changed.push(inc.name);
      } else {
        kept.push(inc.name);
      }
      return merged;
    });

    var removed = (existing || []).filter(function (it) { return !usedIds[it.id]; })
      .map(function (it) { return it.name; });

    return { items: items, added: added, removed: removed, changed: changed, kept: kept };
  }

  // ── Coach consents ────────────────────────────────────────────────────────

  // The two consents the coach asks for (learning plan D9, approved wording in
  // section 4). The server stores the version a client agreed to; the
  // dashboard will show the wording for that version. Any change to the
  // wording needs Chris's approval and a new version, which every client sees
  // and taps again.
  var CONSENTS = {
    1: {
      version: 'c1-2026-09-22',
      // The disclosure on the welcome screen. Tapping I'm in agrees to it.
      paragraphs: [
        'The Brofessor is AI, not a person. Chats with him are saved and a human coach can read them. ' +
          'Anything he flags gets reviewed by a real person.'
      ],
      yes: 'I’m in',
      // Shown in place of the text box until I'm in is tapped (the same line
      // the worker sends when it refuses a chat without consent 1).
      locked: 'Tap “I’m in” above to start chatting. Your checklist works either way.'
    },
    2: {
      version: 'c2-2026-09-22',
      title: 'Help The Brofessor learn?',
      paragraphs: [
        'Your chats can be used to make him a better coach, with your name and details stripped out first.'
      ],
      // The same question asked in the chat, where The Brofessor is speaking:
      // the wording Chris approved on 2026-09-21, first person.
      chat: [
        'Can I use our chats to get better at coaching? Anything I learn from gets your name and personal ' +
          'details stripped out first. Saying no changes nothing about how I coach you. You can change your ' +
          'mind any time in Profile.'
      ],
      yes: 'Yes, use my chats',
      no: 'No thanks'
    }
  };

  // The welcome screen (routine change loop brief, 3c): the first thing a
  // client reads. What the app is for, then every consent as a question with
  // two buttons, then one tap. Chris's wording, 2026-09-22. Any change is a
  // new version, and every client sees the screen again.
  var WELCOME = {
    version: 'w2-2026-09-22',
    title: 'Welcome to Beast Mode',
    tagline: 'Unleash the Beast, one habit at a time',
    intro: 'Beast Mode helps you build the habits and routines that carry your health and fitness goals. ' +
      'You get the plan to get fit, and the support to stick with it.',
    features: [
      { icon: 'plan', title: 'Your plan, built for you',
        text: 'Training, food, sleep, the habits in between. Written by a real coach who knows your goals and your day.' },
      { icon: 'today', title: 'One checklist a day',
        text: 'The plan broken into things you tick off. New habits become routine one day at a time.' },
      { icon: 'fire', title: 'Streaks, points, ranks',
        text: 'Follow your plan and earn points. Keep crushing and a streak grows. Can you earn the right to be the Chief Brologist?!' },
      { icon: 'coach', title: 'Support to stick with it',
        text: 'The Brofessor, an AI coach inside the app, knows your plan and your day. Your human coach sees your progress and steps in when it matters.' }
    ],
    heading: 'Before you start',
    questions: {
      share: { title: 'Share your progress with your coach?',
        text: 'Your streak, points and rank go to your coach every day. Nothing else leaves your phone.',
        yes: 'Yes, share it', no: 'Keep it on my phone' },
      nudges: { title: 'Do you want to hear from The Brofessor?',
        text: 'A shout when you hit a milestone or a streak is on the line. Never late at night.',
        yes: 'Yes, hit me up', no: 'No thanks' }
      // The third question is CONSENTS[2].
    },
    button: 'I’m in',
    note: 'Answer all three to continue. You can change any of them in Profile.'
  };

  // The Brofessor's first message in the chat, once the welcome is done.
  // One clause differs by the answer to CONSENTS[2]. Chris's wording.
  var COACH_OPENER = {
    learning: 'Welcome to coaching. I’m The Brofessor, your guide to SHREDZVILLE. We are going to get along great ' +
      '(if you listen to everything I say) LOL!!! Quick reminder before we go: our chats are saved and a human coach ' +
      'reads them, and you’re letting me learn from them to coach better. You can change either in Profile, any time. ' +
      'If you’re ever in a crisis, call or text 988. Now, what are we working on?',
    notLearning: 'Welcome to coaching. I’m The Brofessor, your guide to SHREDZVILLE. We are going to get along great ' +
      '(if you listen to everything I say) LOL!!! Quick reminder before we go: our chats are saved and a human coach ' +
      'reads them, and you’ve kept them out of my training, which is fine by me. You can change that in Profile, any time. ' +
      'If you’re ever in a crisis, call or text 988. Now, what are we working on?'
  };

  // The newest answer on file counts only if it was given to today's wording.
  // `given` is the server's record: { version, answer, at } or null.
  function consentStands(kind, given) {
    var c = CONSENTS[kind];
    return !!(c && given && given.version === c.version &&
      (given.answer === 'yes' || (kind === 2 && given.answer === 'no')));
  }

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    VERSION: VERSION,
    PAYLOAD_VERSION: PAYLOAD_VERSION,
    KINDS: KINDS, FREQS: FREQS, METRICS: METRICS, TIMINGS: TIMINGS, DAYS: DAYS,
    TIMING_LABELS: TIMING_LABELS, timingLabel: timingLabel,
    WEIGHT_UNIT: WEIGHT_UNIT, itemSummary: itemSummary,
    MIN_AGE: MIN_AGE, ageOn: ageOn, isUnderAge: isUnderAge,
    detailLine: detailLine, detailFields: detailFields, usesMetric: usesMetric,
    TARGET_FIELDS: TARGET_FIELDS, metricLabel: metricLabel,
    targetFields: targetFields, formatTarget: formatTarget,
    POINTS: POINTS, LEVELS: LEVELS, PREFIXES: PREFIXES,
    DEFAULT_CORE_BY_KIND: DEFAULT_CORE_BY_KIND, SHARE_LIMITS: SHARE_LIMITS,

    todayLocal: todayLocal, dateToLocal: dateToLocal, localToDate: localToDate,
    localDateOf: localDateOf, addDays: addDays, weekdayIndex: weekdayIndex,
    mondayOf: mondayOf, getWeekDates: getWeekDates, daysBetween: daysBetween,
    datesBetween: datesBetween, minutesOfDay: minutesOfDay, formatDueBy: formatDueBy,

    escapeHtml: escapeHtml, escHTMLAttr: escHTMLAttr, escText: escText,
    newId: newId, isValidId: isValidId,

    logKey: logKey, parseLogKey: parseLogKey,
    normalizeItem: normalizeItem, normalizeItems: normalizeItems, normalizeGoals: normalizeGoals,

    existsOn: existsOn, isScheduled: isScheduled, isAvailable: isAvailable,
    scheduledOn: scheduledOn, scheduledCoreOn: scheduledCoreOn,

    entryFor: entryFor, isDone: isDone, isSameDay: isSameDay, isOnTime: isOnTime,
    markDone: markDone,

    GATES: GATES, dayResult: dayResult, programStart: programStart,
    STATUS_VERSION: STATUS_VERSION, statusPayload: statusPayload, validateStatus: validateStatus, todayIn: todayIn,
    currentStreak: currentStreak, bestStreak: bestStreak,
    totalPoints: totalPoints, perfectWeek: perfectWeek,
    levelThresholds: levelThresholds, levelFor: levelFor, progress: progress,

    encodePayload: encodePayload, decodePayload: decodePayload, extractCode: extractCode,
    packItem: packItem, unpackItem: unpackItem, shareUrlLength: shareUrlLength, linkFromText: linkFromText, needsInstallFirst: needsInstallFirst, heldWelcomeFits: heldWelcomeFits, welcomeStamp: welcomeStamp, iosSafari: iosSafari, hasAppHistory: hasAppHistory,
    validateDraft: validateDraft, mergeDraft: mergeDraft,
    buildBackup: buildBackup, readBackup: readBackup, backupDiff: backupDiff,
    backupFilename: backupFilename, daysSince: daysSince, BACKUP_TYPE: BACKUP_TYPE,
    reminderSlots: reminderSlots, dueAtSlot: dueAtSlot,
    reminderText: reminderText, inQuietHours: inQuietHours,
    buildReport: buildReport, reportSummary: reportSummary,
    INTAKE_VERSION: INTAKE_VERSION, INTAKE_LEGACY: INTAKE_LEGACY, INTAKE_SECTIONS: INTAKE_SECTIONS, intakeFields: intakeFields,
    routineSections: routineSections, visibleSections: visibleSections, visibleFields: visibleFields, intakeVersionOf: intakeVersionOf, routineBaseline: routineBaseline,
    routineChanges: routineChanges, timeFromText: timeFromText, mergeIntakeAnswers: mergeIntakeAnswers,
    ROUTINE_AGAIN_DAYS: ROUTINE_AGAIN_DAYS, checklistChanged: checklistChanged, visibleAnswers: visibleAnswers, YESNO: YESNO,
    formatIntakeForCoach: formatIntakeForCoach,
    goalsFromIntake: goalsFromIntake, profileFromIntake: profileFromIntake,
    CONSENTS: CONSENTS, consentStands: consentStands, WELCOME: WELCOME, COACH_OPENER: COACH_OPENER
  };
})();

if (typeof module === 'object' && module.exports) module.exports = BeastCore;
