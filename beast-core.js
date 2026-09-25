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
  var VERSION = '2.18.0';

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
      detail: detail,
      // Finding the time (goals brief 4i, 4k, 4l). `swap` is the item's place
      // in its block's order of habit changes (0: starts with the plan); the
      // client's pace turns it into a start date, set only on the phone
      // (scheduleSwaps). `steps` are a moving target's later times, each with
      // its own swap number and, once scheduled, its frozen start date `at`.
      swap: posInt(it.swap),
      block: posInt(it.block) || 1,
      replaces: it.replaces == null ? '' : String(it.replaces).trim().slice(0, MAX_REPLACES),
      steps: normalizeSteps(it.steps)
    };
  }

  var MAX_REPLACES = 300;

  function posInt(v) {
    var n = Number(v);
    return isFinite(n) && n >= 1 ? Math.floor(n) : 0;
  }

  function normalizeSteps(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) {
      return s && typeof s === 'object' && posInt(s.swap) && minutesOfDay(s.dueBy) !== null;
    }).map(function (s) {
      return {
        swap: posInt(s.swap),
        dueBy: String(s.dueBy).trim(),
        label: s.label == null ? '' : String(s.label),
        at: /^\d{4}-\d\d-\d\d$/.test(String(s.at || '')) ? s.at : ''
      };
    }).sort(function (a, b) { return a.swap - b.swap; });
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
      var out = {
        id: isValidId(g && g.id) ? g.id : newId(),
        text: g && g.text != null ? String(g.text) : '',
        term: g && g.term === 'long' ? 'long' : 'short',
        completed: !!(g && g.completed)
      };
      // Goals with steps (goals brief 4a, 4k.4). A goal without a measure
      // keeps exactly the shape it always had.
      if (!g || typeof g !== 'object') return out;
      var key = goalKeyOf(g.key);
      if (key) out.key = key;
      if (g.why != null && String(g.why).trim()) out.why = String(g.why).trim();
      var m = normalizeMeasure(g.measure);
      if (m) {
        out.measure = m;
        out.block = posInt(g.block) || 1;
        out.months = normalizeGoalSteps(g.months, m.kind, 'n');
        out.weeks = normalizeGoalSteps(g.weeks, m.kind, m.kind === 'habit' ? 'swap' : 'n');
        // Earlier blocks' weekly steps, kept until they are judged: a new
        // block's draft can land before the last week of the old one ends
        // (CTO, step 1 review). A habit step carries the window it was placed
        // in, since the new block renumbers its swaps.
        if (Array.isArray(g.past)) {
          out.past = g.past.filter(function (p) { return p && posInt(p.block); }).map(function (p) {
            return {
              block: posInt(p.block),
              weeks: normalizeGoalSteps(p.weeks, m.kind, m.kind === 'habit' ? 'swap' : 'n').map(function (s, i) {
                var raw = (p.weeks || []).filter(function (x) { return x && posInt(x[m.kind === 'habit' ? 'swap' : 'n']); })
                  .sort(function (a, b) { var k = m.kind === 'habit' ? 'swap' : 'n'; return a[k] - b[k]; })[i] || {};
                if (m.kind === 'habit' && /^\d{4}-\d\d-\d\d$/.test(String(raw.from || '')) && isValidId(raw.item)) {
                  s.from = raw.from; s.item = raw.item;
                }
                return s;
              })
            };
          });
        }
      }
      if (typeof g.agreedAt === 'string' && g.agreedAt) out.agreedAt = g.agreedAt;
      return out;
    }).filter(function (g) { return g.text.trim() !== ''; });
  }

  // A goal's key is the short name the Brofessor gives it in a draft
  // ("weight", "sleep"). Items point at it, and imports match on it, so a
  // goal keeps its id and its step history from one block to the next.
  function goalKeyOf(k) {
    var s = String(k == null ? '' : k).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,23}$/.test(s) ? s : '';
  }

  var MEASURES = ['weight', 'waist', 'bodyfat', 'fit', 'habit', 'report'];
  var NUMERIC_MEASURES = ['weight', 'waist', 'bodyfat'];
  // How clothes fit, least to most progress.
  var FIT_SCALE = ['tighter', 'same', 'looser'];

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normalizeMeasure(m) {
    if (!m || typeof m !== 'object' || MEASURES.indexOf(m.kind) === -1) return null;
    var out = { kind: m.kind, by: /^\d{4}-\d\d-\d\d$/.test(String(m.by || '')) ? m.by : '' };
    if (NUMERIC_MEASURES.indexOf(m.kind) !== -1) {
      out.start = numOrNull(m.start);
      out.target = numOrNull(m.target);
      if (m.rateReason != null && String(m.rateReason).trim()) out.rateReason = String(m.rateReason).trim();
    } else if (m.kind === 'fit') {
      out.item = m.item == null ? '' : String(m.item).trim();
      out.target = FIT_SCALE.indexOf(m.target) !== -1 ? m.target : 'looser';
    } else {
      out.target = m.target == null ? '' : String(m.target);
    }
    return out;
  }

  // A goal's steps: months are numbered from the plan's start; weeks from the
  // block's start, or, for a habit goal, by the swap they belong to (4k.2).
  function normalizeGoalSteps(list, kind, by) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) { return s && typeof s === 'object' && posInt(s[by]); }).map(function (s) {
      var out = {};
      out[by] = posInt(s[by]);
      out.target = NUMERIC_MEASURES.indexOf(kind) !== -1 ? numOrNull(s.target)
        : kind === 'habit' ? (posInt(s.target) || null)
        : kind === 'fit' ? (FIT_SCALE.indexOf(s.target) !== -1 ? s.target : null)
        : (s.target == null ? '' : String(s.target));
      out.text = s.text == null ? '' : String(s.text);
      return out;
    }).sort(function (a, b) { return a[by] - b[by]; });
  }

  // The id or key an item's goalId may name.
  function goalLink(g) { return (g && (g.key || g.id)) || ''; }

  // A plan update's goals, matched to the ones the client already has: by
  // key first, then by the words for a goal without one. A matched goal keeps
  // its id, whether it is completed, and when it was agreed; its steps and
  // measure come from the update. `changed` names the goals whose card must
  // be agreed again (goals brief 4f).
  function mergeGoals(existing, incoming, prevItems) {
    var byKey = {}, byText = {};
    (existing || []).forEach(function (g) {
      if (g.key) byKey[g.key] = g;
      byText[matchKey(g.text)] = g;
    });
    var used = {}, added = [], changed = [];
    var goals = normalizeGoals(incoming || []).map(function (g) {
      var prev = (g.key && byKey[g.key]) || (!g.key && byText[matchKey(g.text)]) || null;
      if (!prev || used[prev.id]) { added.push(g.text); return g; }
      used[prev.id] = true;
      var out = Object.assign({}, g, { id: prev.id, completed: !!prev.completed });
      if (prev.agreedAt) out.agreedAt = prev.agreedAt;
      // A new block: the old block's weekly steps move to `past`, to be judged
      // when their weeks end. Only the last two blocks are kept; anything
      // older has long since been judged.
      if (g.measure && prev.measure && (g.block || 1) !== (prev.block || 1)) {
        var moved = { block: prev.block || 1, weeks: (prev.weeks || []).map(function (s) {
          var c = Object.assign({}, s);
          if (prev.measure.kind === 'habit') {
            var w = habitWindow(prevItems || [], prev, s.swap, prev.block || 1);
            if (w) { c.from = w.from; c.item = w.item.id; }
          }
          return c;
        }) };
        out.past = (prev.past || []).concat([moved]).filter(function (p) { return p.block >= (g.block || 1) - 2; });
        out = normalizeGoals([out])[0];
      } else if (prev.past) {
        out.past = prev.past;
      }
      var shape = function (x) { return JSON.stringify([x.text, x.why || '', x.measure || null, x.months || [], x.weeks || [], x.block || 1]); };
      if (shape(out) !== shape(prev)) { changed.push(out.id); delete out.agreedAt; }
      if (out.completed !== !!prev.completed) out.completed = !!prev.completed;
      return out;
    });
    var removed = (existing || []).filter(function (g) { return !used[g.id]; }).map(function (g) { return g.text; });
    return { goals: goals, added: added, changed: changed, removed: removed };
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

  // The due time in force on a date. A moving target's later steps take over
  // on their own start dates, so a past day is always judged against the time
  // it had then and a point once earned is never taken back (goals brief 4k.3).
  function dueByOn(item, ymd) {
    var best = null;
    ((item && item.steps) || []).forEach(function (s) {
      if (!s.at || s.at > ymd) return;
      if (!best || s.at > best.at || (s.at === best.at && s.swap > best.swap)) best = s;
    });
    return best ? best.dueBy : ((item && item.dueBy) || '');
  }

  function isOnTime(item, entry, ymd) {
    if (!isSameDay(entry, ymd)) return false;
    var due = minutesOfDay(dueByOn(item, ymd));
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

  // `fixed` holds the thresholds a client has already reached, which never
  // move again (goals brief 4l.5); the tiers above them rescale with the
  // ladder. A rescaled tier is never below the one beneath it.
  function levelThresholds(pw, fixed) {
    var prev = -1;
    return LEVELS.map(function (l) {
      var f = fixed && fixed[l.level];
      var pts = typeof f === 'number' ? f : roundTo50(l.multiple * pw);
      if (pts < prev) pts = prev;
      prev = pts;
      return { level: l.level, rank: l.rank, points: pts };
    });
  }

  // `pw` is the perfectWeek snapshotted at goal agreement, so a later plan
  // update cannot move the ladder under a client who has not lost a point.
  // With goals that have steps it is the ladder's week (ladderWeek).
  function levelFor(points, pw, earnedLevel, fixed) {
    var tiers = levelThresholds(pw, fixed);
    var reached = tiers[0];
    tiers.forEach(function (t) { if (points >= t.points) reached = t; });
    // Ratchet: a rank once earned is never lost.
    if (earnedLevel && earnedLevel > reached.level) {
      reached = tiers[earnedLevel - 1] || reached;
    }
    return reached;
  }

  /* The level-up for the two big first tasks (first-client path, step 5;
     Chris, 2026-09-24): Beast Mode on the home screen, and the intake sent.
     Each is a badge kept for good, and each is worth one perfect day's
     points, a seventh of the plan's perfect week, so it is the same share of
     the ladder on any plan. Earned before a plan exists; the points count
     once a plan does. `starts` is { install: iso, intake: iso }. */
  var STARTS = ['install', 'intake'];

  /* Badges held on the phone before a plan belong to one client, like the
     held welcome: they count only for a plan or a waiting phone carrying the
     same client id, and only within the life of an intake link (CTO,
     2026-09-24). No id on either side means someone else's. */
  function heldStartsFit(held, clientId, today) {
    if (!held || typeof held !== 'object' || !held.clientId || !clientId || held.clientId !== clientId) return false;
    var at = STARTS.map(function (k) { return held[k]; }).filter(function (v) { return typeof v === 'string' && v; }).sort().pop();
    if (!at) return false;
    var age = daysSince(at, today);
    return age !== null && age >= 0 && age <= HELD_WELCOME_DAYS;
  }

  function startPoints(starts, pw) {
    if (!starts || typeof starts !== 'object' || !(pw > 0)) return 0;
    var each = Math.round(pw / 7 / 10) * 10;
    return STARTS.filter(function (k) { return typeof starts[k] === 'string' && starts[k]; }).length * each;
  }

  // `opts.stepLog` adds the points of steps already judged, each stored with
  // its value when it was written (4l.6). `opts.ladder` ({ week, fixed }) is
  // the ladder snapshotted at agreement and each recommit; without one the
  // ladder is the perfect week, as before goals had steps.
  function progress(items, log, opts) {
    opts = opts || {};
    var today = opts.today || todayLocal();
    var pw = opts.perfectWeek || perfectWeek(items);
    // A plan with nothing in it has no perfect week and no points to give.
    var pts = totalPoints(items, log, today) + startPoints(opts.starts, perfectWeek(items) ? pw : 0) +
      stepPoints(opts.stepLog);
    var ladder = opts.ladder && opts.ladder.week > 0 ? opts.ladder : null;
    var lw = ladder ? ladder.week : pw;
    return {
      points: pts,
      perfectWeek: pw,
      ladderWeek: lw,
      streak: currentStreak(items, log, today),
      bestStreak: bestStreak(items, log, today),
      level: levelFor(pts, lw, opts.earnedLevel, ladder && ladder.fixed)
    };
  }

  // ── Goals with steps and finding the time ─────────────────────────────────
  // (goals brief, draft 3, sections 4a, 4i, 4k and 4l)

  // How fast a client's habit changes arrive. The client picks it; the plan
  // sets the changes and their order.
  var PACES = ['slower', 'standard', 'faster'];
  var DEFAULT_PACE = 'standard';
  var BLOCK_DAYS = 28;              // a block is four weeks, and so is a month
  var WEIGHT_MARGIN = 0.3;          // lb: the scale moves this much with water (Chris)
  var STATUS_MAX_STEPS = 6;         // step results in one status (4l.4)

  function paceOf(p) { return PACES.indexOf(p) !== -1 ? p : DEFAULT_PACE; }

  // The week of its block a swap starts in, from its number and the pace.
  function startWeekFor(swap, pace) {
    var n = posInt(swap) || 1;
    var p = paceOf(pace);
    if (p === 'slower') return 1 + 2 * (n - 1);
    if (p === 'faster') return 1 + Math.floor((n - 1) / 2);
    return n;
  }

  function blockStartOf(planStart, block) {
    return addDays(planStart, BLOCK_DAYS * ((posInt(block) || 1) - 1));
  }

  // A swap's start date, never before today (4l.1): a late draft or a faster
  // pace can never reopen a day that has closed.
  function swapDate(swap, o) {
    var d = addDays(blockStartOf(o.planStart, o.block), 7 * (startWeekFor(swap, o.pace) - 1));
    return d > o.today ? d : o.today;
  }

  // Dates every swap item and every moving-target step. Anything already
  // started (a date on or before today, found in `o.prev` by id) keeps its
  // date for good, so a pace change moves only what is still to come (4l.1,
  // 4l.2). The phone is the only caller: a date on the wire is ignored (4l.9).
  function scheduleSwaps(items, o) {
    o = o || {};
    var today = o.today || todayLocal();
    var planStart = o.planStart || today;
    var pace = paceOf(o.pace);
    var prevById = {};
    (o.prev || []).forEach(function (p) { if (p && p.id) prevById[p.id] = p; });
    return (items || []).map(function (it) {
      var prev = prevById[it.id];
      var ctx = { planStart: planStart, block: it.block || 1, pace: pace, today: today };
      var out = Object.assign({}, it);
      if (it.swap) {
        out.addedAt = prev && prev.addedAt && prev.addedAt <= today ? prev.addedAt : swapDate(it.swap, ctx);
      } else if (prev && prev.addedAt > today) {
        // No longer a swap (renumbered into a started change, or made a plain
        // item): it starts today rather than staying hidden (CTO, step 1).
        out.addedAt = today;
      }
      if (it.steps && it.steps.length) {
        var prevSteps = {};
        ((prev && prev.steps) || []).forEach(function (s) { prevSteps[s.swap] = s; });
        out.steps = it.steps.map(function (s) {
          var ps = prevSteps[s.swap];
          var at = ps && ps.at && ps.at <= today ? ps.at : swapDate(s.swap, ctx);
          return Object.assign({}, s, { at: at });
        });
      }
      return out;
    });
  }

  // Points for a step, from the perfect week snapshotted at first agreement:
  // a weekly step is one perfect day, a monthly step one perfect week.
  function stepValue(kind, pw) {
    if (!(pw > 0)) return 0;
    return kind === 'm' ? Math.round(pw / 10) * 10 : Math.round(pw / 7 / 10) * 10;
  }

  function stepPoints(stepLog) {
    if (!stepLog || typeof stepLog !== 'object') return 0;
    return Object.keys(stepLog).reduce(function (sum, k) {
      var r = stepLog[k];
      return sum + (r && r.result === 'hit' && r.points > 0 ? r.points : 0);
    }, 0);
  }

  // The ladder's week: the whole block's perfect week plus what its goals'
  // steps could pay in a week, so a client with three goals needs more points
  // for each rank than one with one goal, and all climb at about the same
  // rate (Chris, 2026-09-25: harder ranks; 4k.6, 4l.10).
  function ladderWeek(items, goals, pw) {
    var steps = (goals || []).reduce(function (sum, g) {
      if (!g.measure) return sum;
      var w = (g.weeks && g.weeks.length) ? stepValue('w', pw) : 0;
      var m = (g.months && g.months.length) ? stepValue('m', pw) / 4 : 0;
      return sum + w + m;
    }, 0);
    return Math.round(perfectWeek(items || []) + steps);
  }

  // A new ladder at agreement or recommit. The thresholds of every rank the
  // client has already reached stay where they were (4l.5).
  function ladderSnapshot(week, prev, earnedLevel) {
    var fixed = {};
    if (prev && prev.week > 0) {
      var old = levelThresholds(prev.week, prev.fixed);
      old.forEach(function (t) { if (t.level <= (earnedLevel || 1)) fixed[t.level] = t.points; });
    }
    return { week: Math.round(week), fixed: fixed };
  }

  // What the rank bar shows: the rank, the next one, how far, as 0 to 100.
  function rankProgress(points, ladderWk, earnedLevel, fixed) {
    var tiers = levelThresholds(ladderWk, fixed);
    var level = levelFor(points, ladderWk, earnedLevel, fixed);
    var next = tiers.filter(function (t) { return t.level > level.level; })[0] || null;
    if (!next) return { level: level, next: null, toNext: 0, pct: 100 };
    var floor = level.points;
    var span = next.points - floor;
    var pct = span > 0 ? Math.round(((points - floor) / span) * 100) : 100;
    return { level: level, next: next, toNext: Math.max(0, next.points - points), pct: Math.max(0, Math.min(100, pct)) };
  }

  // ── Judging steps ─────────────────────────────────────────────────────────
  // The phone is the one place a step is judged (4k.5). Each result is
  // written once into state.stepLog with its points and never worked out
  // again. Keys (4l.8): goalId|block|w|n for a week, goalId|0|m|n for a
  // month (months run from the plan's start), goalId|block|s|swap for a
  // habit step, which the pace does not move.

  function stepKey(goalId, block, kind, n) { return goalId + '|' + block + '|' + kind + '|' + n; }

  function average(list) {
    if (!list.length) return null;
    var s = list.reduce(function (a, b) { return a + b; }, 0) / list.length;
    return Math.round(s * 100) / 100;
  }

  // The reading a step is judged on, or null when there is none.
  function readingFor(kind, from, to, st) {
    var days = datesBetween(from, to);
    if (kind === 'weight') {
      var wl = st.weightLog || {};
      return average(days.map(function (d) { return Number(wl[d]); }).filter(function (n) { return isFinite(n) && n > 0; }));
    }
    var ml = st.measureLog || {};
    var found = null;
    days.forEach(function (d) {
      var r = ml[d];
      if (r && r[kind] !== undefined && r[kind] !== null && r[kind] !== '') found = r[kind];
    });
    return found;
  }

  function goalRises(g) {
    var m = g.measure || {};
    if (typeof m.start === 'number' && typeof m.target === 'number') return m.target > m.start;
    return true;
  }

  function hitFor(kind, value, target, rises) {
    if (kind === 'fit') return FIT_SCALE.indexOf(value) >= FIT_SCALE.indexOf(target);
    var margin = kind === 'weight' ? WEIGHT_MARGIN : 0;
    return rises ? value >= target - margin : value <= target + margin;
  }

  // Every step that has ended and has no result yet, judged in date order.
  // Catches up after days the app was not opened (4k.9). `st` is the app's
  // state: items, log, goals, weightLog, measureLog, stepLog, stepAnswers,
  // perfectWeek and profile.startDate. Returns new records; writes nothing.
  function judgeSteps(st, today) {
    today = today || todayLocal();
    st = st || {};
    var planStart = st.profile && st.profile.startDate;
    if (!planStart || !st.goalsAgreedAt) return [];
    var done = st.stepLog || {};
    var answers = st.stepAnswers || {};
    var pw = st.perfectWeek || 0;
    var out = [];
    var add = function (key, rec) { if (!done[key]) out.push(Object.assign({ key: key, sent: false }, rec)); };

    (st.goals || []).forEach(function (g) {
      var m = g.measure;
      if (!m) return;
      // This block's weekly steps, and any earlier block's still to judge.
      var blocks = [{ block: g.block || 1, weeks: g.weeks || [], current: true }].concat(g.past || []);
      blocks.forEach(function (b) {
        var block = b.block;
        var bStart = blockStartOf(planStart, block);
        if (m.kind === 'habit') {
          (b.weeks || []).forEach(function (s) {
            // The current block finds its change by swap number; a past
            // block's step kept the window it was placed in.
            var found = b.current ? habitWindow(st.items || [], g, s.swap, block)
              : (s.from && s.item ? { from: s.from, item: itemById(st.items, s.item) || { id: s.item, past: true } } : null);
            if (!found) return;                      // its change has not been placed yet
            var end = addDays(found.from, 6);
            if (!(today > end)) return;
            var count = datesBetween(found.from, end).filter(function (d) {
              return (found.item.past || isAvailable(found.item, d)) && isDone(st.log || {}, found.item.id, d);
            }).length;
            var target = s.target || 1;
            var hit = count >= target;
            add(stepKey(g.id, block, 's', s.swap), { goal: g.id, kind: 's', n: s.swap, block: block, end: end,
              result: hit ? 'hit' : 'missed', value: count, target: target, points: hit ? stepValue('w', pw) : 0 });
          });
        } else {
          (b.weeks || []).forEach(function (s) {
            var from = addDays(bStart, 7 * (s.n - 1)), end = addDays(from, 6);
            var rec = judgeOne(g, m.kind, s, from, end, stepKey(g.id, block, 'w', s.n), today, st, answers);
            if (rec) add(rec.key, Object.assign(rec.body, { goal: g.id, kind: 'w', n: s.n, block: block, end: end,
              points: rec.body.result === 'hit' ? stepValue('w', pw) : 0 }));
          });
        }
      });
      (g.months || []).forEach(function (s) {
        var end = addDays(planStart, BLOCK_DAYS * s.n - 1);
        // A month's weight is the average of its last week; a measurement is
        // the latest in the month.
        var from = m.kind === 'weight' || m.kind === 'habit' ? addDays(end, -6) : addDays(end, -(BLOCK_DAYS - 1));
        var rec = m.kind === 'habit'
          ? judgeHabitMonth(g, s, from, end, stepKey(g.id, 0, 'm', s.n), today, st)
          : judgeOne(g, m.kind, s, from, end, stepKey(g.id, 0, 'm', s.n), today, st, answers);
        if (rec) add(rec.key, Object.assign(rec.body, { goal: g.id, kind: 'm', n: s.n, block: 0, end: end,
          points: rec.body.result === 'hit' ? stepValue('m', pw) : 0 }));
      });
    });
    return out.sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
  }

  function itemById(items, id) {
    for (var i = 0; i < (items || []).length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  // The item a habit step counts, and the week it runs: the change with that
  // swap number in the goal's block, or a moving target's step of that number.
  function habitWindow(items, g, swap, block) {
    var link = goalLink(g);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.goalId !== link && it.goalId !== g.id) continue;
      if ((it.block || 1) !== block) continue;
      if (it.swap === swap) return { item: it, from: it.addedAt };
      for (var j = 0; j < (it.steps || []).length; j++) {
        var s = it.steps[j];
        if (s.swap === swap && s.at) return { item: it, from: s.at };
      }
    }
    return null;
  }

  // One outcome step. Weight with no weigh-ins is a miss; a tape, a scale or
  // a pair of jeans that was not checked that week is skipped, not missed
  // (Measure day is every 14 days). A "Did you hit it?" step waits one more
  // day for its answer.
  function judgeOne(g, kind, s, from, end, key, today, st, answers) {
    if (kind === 'report') {
      var a = answers[key];
      if (a !== true && a !== false) {
        if (!(today > addDays(end, 1))) return null;
        return { key: key, body: { result: 'missed', value: null, target: s.target } };
      }
      if (!(today > end) && a !== true) return null;
      return { key: key, body: { result: a ? 'hit' : 'missed', value: a, target: s.target } };
    }
    if (!(today > end)) return null;
    // A step with no usable target is closed as skipped, never left open.
    if (s.target === null || s.target === undefined || s.target === '') {
      return { key: key, body: { result: 'skipped', value: null, target: null } };
    }
    var value = readingFor(kind, from, end, st);
    if (value === null || value === undefined) {
      return { key: key, body: { result: kind === 'weight' ? 'missed' : 'skipped', value: null, target: s.target } };
    }
    return { key: key, body: { result: hitFor(kind, value, s.target, goalRises(g)) ? 'hit' : 'missed', value: value, target: s.target } };
  }

  // A habit goal's month, judged on its last week: the days on which every
  // one of the goal's items that was due got done.
  function judgeHabitMonth(g, s, from, end, key, today, st) {
    if (!(today > end) || !s.target) return null;
    var link = goalLink(g);
    var mine = (st.items || []).filter(function (it) { return it.goalId === link || it.goalId === g.id; });
    var count = datesBetween(from, end).filter(function (d) {
      var due = mine.filter(function (it) { return isScheduled(it, d); });
      return due.length > 0 && due.every(function (it) { return isDone(st.log || {}, it.id, d); });
    }).length;
    return { key: key, body: { result: count >= s.target ? 'hit' : 'missed', value: count, target: s.target } };
  }

  // The results still to reach the server, oldest first, at most six a status.
  function unsentSteps(stepLog) {
    var log = stepLog || {};
    return Object.keys(log).map(function (k) { return log[k]; })
      .filter(function (r) { return r && !r.sent; })
      .sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; })
      .slice(0, STATUS_MAX_STEPS);
  }

  // ── Daily status ──────────────────────────────────────────────────────────
  // What the phone sends the server about the day (routine change loop brief,
  // 3a): the numbers already on the client's screen, nothing else. Built here
  // so the app and the worker share one vocabulary; checked here so the
  // worker refuses anything that is not this shape.

  // Version 2 adds the steps block (goals brief 4k.5, 4l.4). A status without
  // it still goes as version 1, so a server that predates it reads it as ever.
  var STATUS_VERSION = 2;
  var STATUS_FIELDS = ['streak', 'bestStreak', 'points', 'dayPoints', 'level', 'scheduled', 'done', 'scheduledCore', 'doneCore', 'day'];

  function statusPayload(state, opts) {
    opts = opts || {};
    var items = (state && state.items) || [];
    var log = (state && state.log) || {};
    var today = opts.today || todayLocal();
    var p = progress(items, log, { today: today, perfectWeek: state && state.perfectWeek, earnedLevel: state && state.earnedLevel,
      starts: state && state.starts, stepLog: state && state.stepLog, ladder: state && state.ladder });
    var due = scheduledOn(items, today);
    var core = scheduledCoreOn(items, today);
    var doneOf = function (list) { return list.filter(function (it) { return isDone(log, it.id, today); }).length; };
    var y = addDays(today, -1);
    var yr = dayResult(items, log, y);
    var tr = dayResult(items, log, today);
    var start = programStart(items);
    var out = {
      v: 1,
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
    // Step results and the pace, only when the app asks for them: the server
    // stores them from build step 6, and a result is marked sent only after
    // the server has said yes (4l.4).
    if (opts.steps) {
      out.v = 2;
      out.steps = {
        pace: paceOf(state && state.pace),
        outcomes: unsentSteps(state && state.stepLog).map(function (r) {
          return { key: r.key, goal: r.goal, kind: r.kind, n: r.n, block: r.block, end: r.end,
            result: r.result, value: r.value === undefined ? null : r.value, target: r.target === undefined ? null : r.target, points: r.points || 0 };
        })
      };
    }
    return out;
  }

  var STEP_KINDS = ['w', 'm', 's'];
  var STEP_RESULTS = ['hit', 'missed', 'skipped'];

  // A steps block from the phone, checked field by field. Anything off the
  // shape refuses the whole status, as the rest of validateStatus does.
  function validateSteps(raw) {
    if (!raw || typeof raw !== 'object') return { error: 'Bad steps.' };
    if (PACES.indexOf(raw.pace) === -1) return { error: 'Bad pace.' };
    if (!Array.isArray(raw.outcomes) || raw.outcomes.length > STATUS_MAX_STEPS) return { error: 'Bad step outcomes.' };
    var small = function (v) {
      return v === null || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v) && Math.abs(v) < 100000) ||
        (typeof v === 'string' && v.length <= 40);
    };
    var outcomes = [];
    for (var i = 0; i < raw.outcomes.length; i++) {
      var o = raw.outcomes[i];
      if (!o || typeof o !== 'object' || !isValidId(o.goal) || o.goal.length > 64) return { error: 'Bad step goal.' };
      if (STEP_KINDS.indexOf(o.kind) === -1 || STEP_RESULTS.indexOf(o.result) === -1) return { error: 'Bad step result.' };
      if (!posInt(o.n) || o.n !== posInt(o.n) || o.n > 999) return { error: 'Bad step number.' };
      if (typeof o.block !== 'number' || o.block !== Math.floor(o.block) || o.block < 0 || o.block > 99) return { error: 'Bad step block.' };
      if (!/^\d{4}-\d\d-\d\d$/.test(String(o.end || ''))) return { error: 'Bad step date.' };
      if (o.key !== stepKey(o.goal, o.block, o.kind, o.n)) return { error: 'Bad step key.' };
      if (!small(o.value) || !small(o.target)) return { error: 'Bad step value.' };
      if (typeof o.points !== 'number' || o.points < 0 || o.points !== Math.floor(o.points) || o.points > STATUS_MAX_POINTS) return { error: 'Bad step points.' };
      outcomes.push({ key: o.key, goal: o.goal, kind: o.kind, n: o.n, block: o.block, end: o.end,
        result: o.result, value: o.value, target: o.target, points: o.points });
    }
    return { ok: true, steps: { pace: raw.pace, outcomes: outcomes } };
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
    if (raw.steps !== undefined && raw.steps !== null) {
      var sv = validateSteps(raw.steps);
      if (sv.error) return { error: sv.error };
      out.steps = sv.steps;
    }
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
    if (it.swap) o.w = it.swap;
    if (it.block && it.block !== 1) o.b = it.block;
    if (it.replaces) o.p = it.replaces;
    if (it.steps && it.steps.length) o.s = it.steps.map(function (s) { return [s.swap, s.dueBy, s.label || '', s.at || '']; });
    return o;
  }

  // A plan that uses swaps, moving targets or goals with steps goes out as
  // version 3, which an app from before them refuses with its readable
  // message instead of putting every change on day one (goals brief 4k.7).
  // Anything else still goes as version 2.
  var PAYLOAD_STEPS = 3;
  function needsStepsVersion(data) {
    var items = Array.isArray(data.items) ? data.items : [];
    var goals = Array.isArray(data.goals) ? data.goals : [];
    return items.some(function (it) { return it && (it.swap || (it.steps && it.steps.length) || it.w || it.s); }) ||
      goals.some(function (g) { return g && g.measure; });
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
      detail: o.x || {},
      swap: o.w || 0,
      block: o.b || 1,
      replaces: o.p || '',
      steps: Array.isArray(o.s) ? o.s.map(function (s) {
        return Array.isArray(s) ? { swap: s[0], dueBy: s[1], label: s[2] || '', at: s[3] || '' } : s;
      }) : []
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
    var wire = Object.assign({}, data, { v: needsStepsVersion(data) ? PAYLOAD_STEPS : PAYLOAD_VERSION });
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

      if (Number(data.v) > PAYLOAD_STEPS) {
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
  // A moving target's later times are slots from the start, so a step that
  // begins weeks later still has its reminder; dueAtSlot picks the one in
  // force on the day (goals brief 4l.3).
  function reminderSlots(items) {
    var seen = {};
    (items || []).forEach(function (it) {
      if (it.dueBy && minutesOfDay(it.dueBy) !== null) seen[it.dueBy] = true;
      (it.steps || []).forEach(function (s) { if (minutesOfDay(s.dueBy) !== null) seen[s.dueBy] = true; });
    });
    return Object.keys(seen).sort();
  }

  // What is still outstanding at a given slot on a given date. Anything already
  // done is left out, so a client who finished early is not nagged.
  function dueAtSlot(items, log, ymd, slot) {
    return (items || []).filter(function (it) {
      if (dueByOn(it, ymd) !== slot) return false;
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

  // True when nothing says how old they are: no readable date of birth and
  // no stated age (version 1). The coach opens the moment a first intake is
  // sent, so a blank is not allowed through (intake review, 2026-09-24).
  function ageUnknown(answers, today) {
    var a = answers || {};
    var stated = (a.age === '' || a.age == null) ? NaN : Number(a.age);
    return isNaN(stated) && ageOn(a.birthday, today) === null;
  }

  // ── Songs ────────────────────────────────────────────────────────────────
  // The Brofessor writes a song as its own line, "Song: Artist - Title"
  // (methods 6c). The app puts a Play button beside it that searches the
  // client's own music service: a search needs no account and no
  // permission, and a slightly wrong title still finds the song.

  // The song on a line of coach text, or null. A list mark or number in
  // front ("- ", "3. ") is allowed; anything after the song is not a song.
  function songOf(line) {
    var m = /^\s*(?:[-*•]\s*|\d+[.)]\s*)?song:\s*(\S.*?)\s*$/i.exec(String(line || ''));
    return m && m[1].length <= 200 ? m[1] : null;
  }

  // The search for a song in the client's service, by the intake's answer.
  // No answer, "something else" or no music: YouTube Music, which plays in
  // any browser without an account.
  var SONG_SEARCH = {
    'Spotify': 'https://open.spotify.com/search/',
    'Apple Music': 'https://music.apple.com/us/search?term=',
    'Amazon Music': 'https://music.amazon.com/search/',
    'YouTube Music': 'https://music.youtube.com/search?q='
  };
  function songSearchUrl(service, song) {
    var base = SONG_SEARCH[String(service || '')] || SONG_SEARCH['YouTube Music'];
    return base + encodeURIComponent(String(song || '').replace(/\s+-\s+/, ' '));
  }

  // Apple Music opens a search link on its Search tab with the words gone
  // (Chris, on his phone, 2026-09-24), so for Apple Music the app asks
  // Apple's public song search for the song's own page first. The answer is
  // trusted only when it is a music.apple.com address.
  function appleSongLookupUrl(song) {
    return 'https://itunes.apple.com/search?entity=song&limit=1&country=us&term=' +
      encodeURIComponent(String(song || '').replace(/\s+-\s+/, ' '));
  }
  function appleSongLink(result) {
    var r = result && result.results && result.results[0];
    var url = r && typeof r.trackViewUrl === 'string' ? r.trackViewUrl : '';
    return /^https:\/\/music\.apple\.com\/[^\s"'<>]+$/.test(url) ? url : '';
  }

  /* A returning client's earlier answers that the form today can show as
     they were given (Chris, 2026-09-24): a re-sent form starts with them.
     A tap question keeps an answer only if it is one of today's options; a
     time only if it is a time in words from the wheel ('5:30pm'); a date,
     number or height only in its own shape. Typed answers to questions that
     are now taps (version 2) stay out, so no chip is shown picked that the
     client never tapped. The name comes from the link, not from here. */
  function answersThatFit(answers) {
    var a = answers || {}, out = {};
    var DUNNO = 'don’t know';
    intakeFields().forEach(function (f) {
      var v = a[f.key];
      if (blank(v) || f.key === 'firstName' || f.key === 'lastName') return;
      var s = String(v).trim(), ok;
      if (f.type === 'choice') ok = f.options.indexOf(s) >= 0;
      else if (f.type === 'yesno') ok = YESNO.indexOf(s) >= 0;
      else if (f.type === 'multi') ok = picksOf(s).length > 0 && picksOf(s).every(function (p) { return f.options.indexOf(p) >= 0; });
      else if (f.type === 'time') ok = /^(\d{1,2}(:\d{2})?(am|pm)|noon|midnight)$/.test(s);
      else if (f.type === 'date') ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
      else if (f.type === 'number' || f.type === 'height') ok = /^\d+(\.\d+)?$/.test(s) || (f.dunno && s === DUNNO);
      else ok = true;   // a typed box: the client's own words still fit
      if (ok) out[f.key] = s;
    });
    return out;
  }

  // A name as typed on the dashboard, split for the form's two boxes:
  // the first word, and the rest ("Mary Ann Smith" -> "Mary", "Ann Smith").
  function nameParts(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return { first: words[0] || '', last: words.slice(1).join(' ') };
  }

  // Height from the two wheels, and back: 6 ft 2 in is 74 inches, stored as
  // '74' so everything that read inches still does (Chris, 2026-09-24).
  function inchesOf(feet, inches) {
    var f = parseInt(feet, 10), i = parseInt(inches, 10);
    // No feet, no height: inches alone would be a 2-inch client (CTO).
    if (isNaN(f) || f <= 0) return '';
    return String((isNaN(f) ? 0 : f) * 12 + (isNaN(i) ? 0 : i));
  }
  function feetInchesOf(total) {
    var t = parseFloat(total);
    if (isNaN(t) || t <= 0) return { feet: '', inches: '' };
    var r = Math.round(t);
    return { feet: String(Math.floor(r / 12)), inches: String(r % 12) };
  }
  // '74' -> '6 ft 2 in (74 in)', for the summary and the coach. Anything
  // that is not a number of inches is shown as it was typed.
  function heightWords(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return s;
    var fi = feetInchesOf(s);
    return fi.feet + ' ft ' + fi.inches + ' in (' + Math.round(parseFloat(s)) + ' in)';
  }

  // The keys of the required fields among those shown that are still blank.
  function missingRequired(fields, answers) {
    var a = answers || {};
    return (fields || []).filter(function (f) {
      return f.required && String(a[f.key] == null ? '' : a[f.key]).trim() === '';
    }).map(function (f) { return f.key; });
  }

  // The intake's own version (loop brief 5b). Version 1 asked "Your day" in
  // three fields (wakeTime, workHours, bedTime). Version 2 asks for the
  // client's real routine, a work day and a day off, so the plan places each
  // new habit into the day they actually have. Everything that reads answers
  // takes both shapes: existing clients answered version 1. Version 3
  // (2026-09-24) is the form as taps; version 2's typed keys live on in
  // INTAKE_LEGACY. The worker refuses a version newer than it knows, so a
  // phone ahead of the worker is told, rather than having answers dropped.
  var INTAKE_VERSION = 3;

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
    // Goals as taps (intake review, Chris, 2026-09-24): these went, and
    // anything like them goes in the page's Anything else box.
    habitKeep: { label: 'What do you like most about your day?', section: 'Goals' },
    habitBreak: { label: 'What do you like least about your day?', section: 'Goals' },
    testComing: { label: 'Any fitness tests coming up? Which, and when', section: 'Goals' },
    otherGoals: { label: 'Any goals that aren’t fitness related?', section: 'Goals' },
    // The typed routine answers, before the time wheels (2026-09-24). Each
    // still fills its slot of the baseline when the new keys are blank.
    activity: { label: 'How active is that?', section: 'Your work day', always: true },
    workHours: { label: 'Leave for work, work start and end, commute', section: 'Your work day', replaces: 'workStart' },
    workMeals: { label: 'When you eat, roughly, and where', section: 'Your work day', replaces: 'workMealCount' },
    offMeals: { label: 'When you eat, roughly, and where', section: 'Your days off', replaces: 'offMealCount' },
    alcohol: { label: 'Alcohol in a normal week', section: 'Most days', replaces: 'alcoholNights' },
    caffeine: { label: 'Caffeine on a normal day', section: 'Most days', replaces: 'caffeineCount' },
    calories: { label: 'Total calories on a normal day', section: 'Most days' },
    awayNights: { label: 'Nights away from home in a normal month', section: 'Most days' },
    teeth: { label: 'How often do you brush and floss?', section: 'Health' },
    gym: { label: 'Which gym, and how far from home or work?', section: 'Training' },
    hobbies: { label: 'Hobbies that take up evenings or weekends', section: 'Training' },
    supplementsOpen: { label: 'Willing to add supplements if the plan calls for them?', section: 'Health' },
    sleep: { label: 'How do you sleep?', section: 'Health' },
    // Music's two typed boxes, one since 2026-09-24.
    bandsMusic: { label: 'Bands or artists', section: 'Music' },
    songs: { label: 'Songs', section: 'Music' },
    // Tools as yes and no, before the one set of chips (2026-09-24).
    foodAppYes: { label: 'Do you use a food-tracking app?', section: 'Tools' },
    foodApp: { label: 'Which one?', section: 'Tools', when: { key: 'foodAppYes', is: 'yes' } },
    scale: { label: 'A scale at home?', section: 'Tools' },
    treadmillYes: { label: 'Do you have a treadmill you can use?', section: 'Tools' },
    treadmill: { label: 'Where?', section: 'Tools', when: { key: 'treadmillYes', is: 'yes' } },
    hrMonitor: { label: 'A heart-rate monitor?', section: 'Tools' },
    bandsYes: { label: 'Exercise bands?', section: 'Tools' },
    bands: { label: 'Which bands?', section: 'Tools', when: { key: 'bandsYes', is: 'yes' } },
    bodyToolsYes: { label: 'Any body work tools?', section: 'Tools' },
    bodyTools: { label: 'Which body work tools?', section: 'Tools', when: { key: 'bodyToolsYes', is: 'yes' } },
    // One typed medication, before any number could be tapped (2026-09-24).
    ancName: { label: 'What is it?', section: 'Your prescription' },
    ancDose: { label: 'Dose', section: 'Your prescription' },
    ancSchedule: { label: 'When you take it', section: 'Your prescription' },
    ancSince: { label: 'How long you’ve been on it', section: 'Your prescription' },
    ancSideEffectsYes: { label: 'Any side effects?', section: 'Your prescription' },
    ancSideEffects: { label: 'What are they?', section: 'Your prescription', when: { key: 'ancSideEffectsYes', is: 'yes' } },
    // Asked as "Any side effects? If so, what?" now.
    ancPrescriber: { label: 'Who prescribes it, and the next follow-up', section: 'Your prescription' }
  };

  /* The routine questions asked for both a work day and a day off, as taps
     (intake review, Chris, 2026-09-24): times on the phone's time wheel
     (stored in words, see clockWords), the rest as chips or buttons. Each
     key is prefixed by the pass; `ask` names the question so the two days
     compare. The work day adds its fixed blocks (`work` entries). Only what
     a plan uses is asked: leave time, commute and the first thing they do
     went, and meals are "how many times", then a time and a where for each.
     Wording is draft. */
  var MAX_MEALS = 6;
  var ROUTINE_ASKS = [
    { key: 'wake', label: 'Wake up', type: 'time' },
    { key: 'start', work: true, label: 'Start work', type: 'time' },
    { key: 'end', work: true, label: 'Finish work', type: 'time' },
    { key: 'mealCount', label: 'How many times do you eat?', type: 'choice', options: ['1', '2', '3', '4', '5', '6'] }
  ];
  for (var mi = 1; mi <= MAX_MEALS; mi++) {
    ROUTINE_ASKS.push({ key: 'meal' + mi, label: 'Meal ' + mi, type: 'time', meal: mi });
    ROUTINE_ASKS.push({ key: 'meal' + mi + 'Where', label: 'Meal ' + mi + ', where', hideLabel: true, type: 'choice', meal: mi, where: true });
  }
  ROUTINE_ASKS.push(
    { key: 'train', label: 'Best time to train', type: 'time' },
    { key: 'train2', label: 'Second choice', type: 'time' },
    { key: 'evening', label: 'Your evening', type: 'multi',
      options: ['dinner', 'kids', 'TV', 'phone', 'alcohol', 'gaming', 'computer', 'chores', 'a second job'] },
    { key: 'bed', label: 'Bed time', type: 'time' }
  );

  // A work day with no set hours has no start or finish to ask.
  var NO_SET_HOURS = 'no set work hours';

  function routinePass(prefix) {
    return ROUTINE_ASKS.filter(function (f) { return prefix === 'work' || !f.work; }).map(function (f) {
      var out = { key: prefix + f.key[0].toUpperCase() + f.key.slice(1), label: f.label, type: f.type, ask: f.key };
      if (f.options) out.options = f.options;
      if (f.hideLabel) out.hideLabel = true;
      // Where each meal is eaten: work is a place only on a work day.
      if (f.where) out.options = prefix === 'work' ? ['home', 'work', 'out'] : ['home', 'out'];
      // Meal n shows once they say they eat n or more times. The app draws
      // a meal's time and its where on one line (`whereKey`, `joined`).
      if (f.meal) out.when = { key: prefix + 'MealCount', atLeast: f.meal };
      if (f.meal && !f.where) out.whereKey = prefix + 'Meal' + f.meal + 'Where';
      if (f.where) out.joined = true;
      if (f.work) out.unless = { key: 'job', is: NO_SET_HOURS };
      return out;
    });
  }

  // The medications the prescription page lists, each with a short key for
  // its own questions (rxTestForm, rxGlpDose...). 'other' asks for a name.
  var RX_MEDS = [
    { name: 'testosterone', key: 'Test' }, { name: 'GLP-1', key: 'Glp' }, { name: 'thyroid', key: 'Thy' },
    { name: 'blood pressure', key: 'Bp' }, { name: 'cholesterol', key: 'Chol' }, { name: 'metformin', key: 'Met' },
    { name: 'antidepressant', key: 'Ad' }, { name: 'other', key: 'Other' }
  ];

  function rxFields(m) {
    var p = 'rx' + m.key, show = { key: 'rxMeds', picked: [m.name] };
    var title = m.name === 'GLP-1' ? 'GLP-1' : m.name.charAt(0).toUpperCase() + m.name.slice(1);
    var injected = { key: p + 'Form', is: 'injection' };
    var f = [];
    // `label` names the medication for the summary and the coach; on screen,
    // under the medication's own heading, `shortLabel` is enough. Units are
    // shown as written (`asIs`): mg and mL, not Mg and ML.
    if (m.key === 'Other') f.push({ key: p + 'Name', label: 'Other: what is it?', shortLabel: 'What is it?', type: 'text', hint: 'Semaglutide, levothyroxine' });
    f.push(
      { key: p + 'Form', label: title + ': form', shortLabel: 'Form', type: 'choice', options: ['injection', 'pill', 'gel or cream', 'patch', 'pellet'] },
      // An injection is asked as the total a week (Chris, 2026-09-24: 200 mg
      // a week, injected daily); a pill, gel or anything else as each dose,
      // the way its label reads. Two keys, so one is never read as the other.
      { key: p + 'Week', label: title + ': total a week', shortLabel: 'Total a week', type: 'number', hint: '200', when: injected },
      { key: p + 'Dose', label: title + ': each dose', shortLabel: 'Each dose', type: 'number', hint: '100', unless: injected },
      { key: p + 'Unit', label: title + ': dose unit', hideLabel: true, asIs: true, type: 'choice', options: ['mg', 'mcg', 'units', 'mL'] },
      { key: p + 'Often', label: title + ': how often', shortLabel: 'How often', type: 'choice',
        // "twice a day": metformin morning and evening (Chris, 2026-09-24).
        options: ['twice a day', 'daily', 'every other day', '3 times a week', 'twice a week', 'weekly', 'every 2 weeks', 'monthly'] },
      { key: p + 'Since', label: title + ': on it for', shortLabel: 'On it for', type: 'choice', options: ['under 3 months', '3 to 12 months', '1 to 5 years', '5+ years'] },
      { key: p + 'Side', label: title + ': any side effects?', shortLabel: 'Any side effects?', type: 'yesno' },
      { key: p + 'SideWhat', label: title + ': what are they?', shortLabel: 'What are they?', type: 'textarea', when: { key: p + 'Side', is: 'yes' } }
    );
    // The medication's name heads its questions on screen.
    f[0].group = title;
    return f.map(function (x) { if (!x.when) x.when = show; else x.also = show; return x; });
  }

  // The Tools page's chips, grouped (Chris, 2026-09-24). Wording is draft.
  var TOOL_GROUPS = [
    { label: 'Tracking', options: ['MyFitnessPal', 'another food app', 'scale', 'blood pressure cuff'] },
    { label: 'Cardio', options: ['treadmill at home', 'treadmill at the gym', 'walking pad', 'Peloton', 'stationary bike', 'rower'] },
    { label: 'Watches and trackers', options: ['Apple Watch', 'Garmin', 'Fitbit', 'Samsung watch', 'Polar watch', 'Whoop', 'Oura',
      'another fitness tracker', 'heart-rate chest strap'] },
    { label: 'Bands and recovery', options: ['mini loop bands', 'long band with handles', 'foam roller', 'massage gun', 'the Stick', 'lacrosse ball'] }
  ];

  var INTAKE_SECTIONS = [
    // Chris's wording, 2026-09-23. Pounds and inches throughout; the date
    // of birth is a date field (the phone's own picker, stored YYYY-MM-DD,
    // which the adults-only check reads); sex is two buttons, not a list.
    { title: 'Personal Info', hint: 'We base our calculations from this data so be as accurate as possible.', fields: [
      { key: 'firstName', label: 'First name', type: 'text' },
      { key: 'lastName', label: 'Last name', type: 'text' },
      // Required: the adults-only check needs it (intake review, 2026-09-24).
      // `need` is what the form says when it is left blank (Chris, 2026-09-24).
      { key: 'birthday', label: 'Date of birth', type: 'date', required: true,
        need: 'Add your date of birth to keep going.' },
      { key: 'sex', label: 'Sex', type: 'choice', options: ['male', 'female'] },
      // Feet and inches on two wheels, stored as inches (Chris, 2026-09-24).
      { key: 'height', label: 'Height', type: 'height' },
      { key: 'weight', label: 'Current weight (lb)', type: 'number', hint: '196' },
      { key: 'goalWeight', label: 'Goal weight (lb)', type: 'number', hint: '185' },
      // The rate check and the goals (block 1 had to choose 205 or 210 by March).
      { key: 'goalBy', label: 'By when?', type: 'choice', options: ['3 months', '6 months', '1 year', 'no date'] },
      { key: 'waist', label: 'Waist (inches)', type: 'number', hint: '38, at the navel, relaxed' },
      // A button beside the box for an honest "I don't know" (`dunno`).
      { key: 'bodyFat', label: 'Body fat %', type: 'number', hint: '22', dunno: true },
      { key: 'maxHr', label: 'Max heart rate', type: 'number', hint: '180', dunno: true },
      // Only a hard effort counts as measured (methods, Zone 2; Chris,
      // 2026-09-24). Asked once there is a number.
      { key: 'maxHrHow', label: 'How did you get it?', type: 'choice',
        options: ['a hard all-out effort', 'my watch or app', 'not sure'],
        when: { key: 'maxHr', picked: true, except: 'don’t know' } },
      { key: 'household', label: 'Who’s at home?', type: 'choice',
        options: ['on my own', 'with a partner', 'partner and kids', 'kids', 'roommates or family'] }
    ] },
    // The page that matters most (Chris, 2026-09-23): second, while attention
    // is fresh, in its own look, and first on the summary. `lead` is The
    // Brofessor's line above the questions; Chris's wording to come.
    // Under the band, one line and then the chips: no heading, no title
    // (Chris, 2026-09-24). `noTitle` keeps the title for the summary only.
    { title: 'Goals', featured: true, noTitle: true,
      lead: 'A goal without a plan is just a wish.',
      hint: 'Choose a goal. You can pick more than one. If you have something else in mind write it below.',
      fields: [
      // Taps, not typing (intake review, Chris, 2026-09-24). A `multi` field
      // stores its picks as one line each, so every reader of a typed answer
      // (goalsFromIntake splits goals by line) still works. `none` is the
      // pick that clears the others. The words in the lists are drafts.
      // `hideLabel`: the page's own line asks it (Chris, 2026-09-24); the
      // label still names it on the summary and for the coach.
      { key: 'goals', label: 'Your goals', hideLabel: true, type: 'multi',
        options: ['lose weight', 'lose fat', 'build muscle', 'get stronger', 'more energy', 'sleep better', 'look younger',
          'better health numbers', 'pass a fitness test', 'feel better in my clothes'] },
      // Deficit size (methods 2): only for someone losing (Chris, 2026-09-24).
      { key: 'cutPace', label: 'How fast do you want to lose it?', type: 'choice',
        options: ['aggressive', 'slow'], when: { key: 'goals', picked: ['lose weight', 'lose fat'] } },
      // Surplus size (methods 2): only for someone gaining.
      { key: 'bulkStyle', label: 'You’re gaining weight. How lean?', type: 'choice',
        options: ['stay lean', 'some softness is fine'], when: { key: 'goalWeight', above: 'weight' } },
      { key: 'whyNow', label: 'Why now?', type: 'multi',
        options: ['a birthday or milestone', 'a doctor’s advice', 'an event coming up', 'tired of feeling this way', 'a fresh start', 'a test coming up'] },
      { key: 'obstacle', label: 'What has stopped you before?', type: 'multi',
        options: ['no plan', 'no time', 'travel', 'lost interest', 'injury', 'snacking', 'weekends', 'alcohol',
          'didn’t know what to eat', 'nobody holding me to it'] },
      { key: 'dietsTried', label: 'Diets you’ve tried', type: 'multi', none: 'none',
        options: ['none', 'low carb or keto', 'fasting', 'counting calories', 'a program like WW', 'meal replacements'] },
      { key: 'dietsResult', label: 'How did it go?', type: 'choice',
        options: ['worked', 'worked, then came back', 'didn’t stick', 'lost muscle'],
        when: { key: 'dietsTried', picked: true, except: 'none' } },
      { key: 'testYes', label: 'Any fitness tests coming up?', type: 'yesno' },
      { key: 'testKind', label: 'Which?', type: 'multi', options: ['military', 'police', 'fire', 'academy', 'race'],
        when: { key: 'testYes', is: 'yes' } },
      { key: 'testOn', label: 'When is it?', type: 'date', future: true, when: { key: 'testYes', is: 'yes' } },
      { key: 'goalsMore', label: 'Anything else?', type: 'textarea',
        hint: 'Your goals in your own words: 15 lb by March, look younger at 50, get the promotion' }
    ] },
    // The routine sections carry `routine: true`: they are the baseline, and
    // the ones asked again when a new plan block arrives (brief 5d).
    // No line under the title (Chris, 2026-09-24). The job is one set of
    // buttons, each a row of the activity table (methods 2); "no set work
    // hours" hides the leave, start and finish.
    { title: 'Your work day', routine: true, pass: 'work',
      fields: [
        // "Weekdays" taps Monday to Friday at once (Chris, 2026-09-24). It is
        // a shortcut, not an answer: only the days themselves are stored.
        { key: 'workDays', label: 'Your work days', type: 'multi', none: 'no set days',
          shortcuts: { 'Weekdays': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
          options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'no set days'] },
        { key: 'job', label: 'Your work is mostly', type: 'choice',
          options: ['at a desk', 'on my feet', 'physical: lifting, carrying', 'driving', NO_SET_HOURS] }
      ].concat(routinePass('work'), [
        { key: 'workCooks', label: 'Who cooks?', type: 'choice', options: ['me', 'my partner', 'we split it', 'mostly takeout'] },
        { key: 'workMore', label: 'Anything else?', type: 'textarea', hint: 'Anything about your work day the taps missed' }
      ]) },
    // No line under the title (Chris, 2026-09-24). The days off are the
    // days not tapped as work days, so they are not asked.
    { title: 'Your days off', routine: true, pass: 'off',
      fields: routinePass('off') },
    // "Most days", as taps, no line under the title (Chris, 2026-09-24).
    // Calories and nights away went (no plan used them); brushing and
    // flossing moved to Health. Steps and water keep their keys.
    { title: 'Most days', routine: true, pass: 'most',
      fields: [
        { key: 'steps', label: 'Steps a day', type: 'choice',
          options: ['don’t know', 'under 5,000', '5,000 to 8,000', '8,000 to 10,000', '10,000 to 12,000', '12,000 to 15,000', 'over 15,000'] },
        { key: 'water', label: 'Water a day', type: 'choice',
          options: ['under 32 oz', '32 to 64 oz', '64 to 100 oz', '100 to 150 oz', 'over 150 oz'] },
        { key: 'alcoholNights', label: 'Nights you drink alcohol', type: 'multi', none: 'none',
          options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'none'] },
        { key: 'alcoholMost', label: 'Alcoholic drinks on your biggest night', type: 'choice', options: ['1 to 2', '3 to 4', '5 to 6', '7 to 9', '10 or more'],
          when: { key: 'alcoholNights', picked: true, except: 'none' } },
        { key: 'caffeineCount', label: 'Coffees, energy drinks or pre-workouts a day', type: 'choice', options: ['0', '1', '2', '3', '4', '5', '6+'] },
        { key: 'caffeineLast', label: 'The last one', type: 'choice', options: ['morning', 'noon', 'afternoon', 'evening'],
          when: { key: 'caffeineCount', atLeast: 1 } },
        { key: 'mostMore', label: 'Anything else?', type: 'textarea', hint: 'Travel, shift changes, anything the taps missed' }
      ] },
    // As taps, no line under the title (Chris, 2026-09-24). The experience
    // answers match the surplus rule's "two or more years of programmed
    // lifting". The gym's name goes in Anything else; hobbies went.
    { title: 'Training', fields: [
      { key: 'experience', label: 'Training experience', type: 'choice',
        options: ['never', 'on and off, no program', 'under 2 years on a program', '2+ years on a program'] },
      { key: 'currentTraining', label: 'What you do now', type: 'multi', none: 'nothing right now',
        options: ['nothing right now', 'weights', 'walking', 'running', 'cycling', 'swimming', 'rowing', 'hiking', 'HIIT or CrossFit', 'boxing', 'classes', 'pilates', 'yoga', 'sports', 'home workouts'] },
      { key: 'trainWhere', label: 'Where you train', type: 'choice', options: ['a gym', 'home gym', 'both', 'no gym'] },
      { key: 'daysPerWeek', label: 'Days a week you can train', type: 'choice', options: ['2', '3', '4', '5', '6', '7'] },
      { key: 'sessionLength', label: 'Minutes per session', type: 'choice', options: ['30', '45', '60', '75', '90'] },
      { key: 'equipment', label: 'Equipment you can use', type: 'multi', none: 'bodyweight only',
        options: ['full gym', 'dumbbells', 'barbell and rack', 'machines', 'cables', 'kettlebells', 'bands', 'bodyweight only'] },
      { key: 'sports', label: 'Sports you play', type: 'multi', none: 'none',
        options: ['none', 'basketball', 'golf', 'soccer', 'pickleball', 'tennis', 'softball or baseball', 'volleyball', 'hockey', 'skiing or snowboarding', 'martial arts'] },
      { key: 'trainingMore', label: 'Anything else?', type: 'textarea', hint: 'Your gym’s name, how often you play, anything the taps missed' }
    ] },
    // Chris's wording, 2026-09-23: Rule One, from the methods file.
    // As taps (Chris, 2026-09-24). The injury follow-ups answer what block 1
    // left open (how long, which movements); the pre-exercise question is
    // the doctor rule's screen, and a yes reaches Chris before any plan.
    { title: 'Health', hint: 'Rule #1 - Don’t get hurt. Rule #2 - See rule #1.', fields: [
      { key: 'injuries', label: 'Injuries or anything that hurts', type: 'multi', none: 'none',
        options: ['none', 'neck', 'shoulder', 'elbow', 'wrist', 'lower back', 'hip', 'knee', 'ankle or foot'] },
      { key: 'injuryHowLong', label: 'How long has it hurt?', type: 'choice', options: ['weeks', 'months', 'years'],
        when: { key: 'injuries', picked: true, except: 'none' } },
      { key: 'injuryWhen', label: 'It hurts when', type: 'multi',
        options: ['pushing', 'pulling', 'squatting', 'overhead', 'gripping', 'running', 'stairs', 'all the time'],
        when: { key: 'injuries', picked: true, except: 'none' } },
      { key: 'injurySeen', label: 'Seen a doctor or PT about it?', type: 'yesno', when: { key: 'injuries', picked: true, except: 'none' } },
      { key: 'parq', label: 'Has a doctor told you to limit exercise, or do you get chest pain, dizziness or fainting when active?', type: 'yesno' },
      { key: 'pregnant', label: 'Pregnant, or planning to be?', type: 'yesno', when: { key: 'sex', is: 'female' } },
      { key: 'conditions', label: 'Medical conditions', type: 'multi', none: 'none',
        options: ['none', 'high blood pressure', 'high cholesterol', 'diabetes or pre-diabetes', 'heart condition', 'asthma', 'thyroid', 'sleep apnea', 'arthritis'] },
      { key: 'allergies', label: 'Food allergies', type: 'multi', none: 'none',
        options: ['none', 'dairy', 'gluten', 'nuts', 'shellfish', 'eggs', 'soy'] },
      { key: 'foodsAvoided', label: 'Foods you won’t eat', type: 'multi', none: 'none',
        options: ['none', 'vegetarian', 'vegan', 'no pork', 'no red meat', 'no fish', 'picky about vegetables'] },
      { key: 'supplements', label: 'Supplements you take now', type: 'multi', none: 'none',
        options: ['none', 'protein powder', 'creatine', 'multivitamin', 'fish oil', 'vitamin D', 'magnesium', 'pre-workout'] },
      { key: 'creatineDose', label: 'Creatine a day', type: 'choice', options: ['3 g', '5 g', '10 g', 'not sure'],
        when: { key: 'supplements', picked: ['creatine'] } },
      { key: 'sleepHours', label: 'Hours of sleep a night', type: 'choice', options: ['under 5', '5 to 6', '6 to 7', '7 to 8', '8+'] },
      { key: 'sleepHow', label: 'How you sleep', type: 'multi',
        options: ['sleep well', 'trouble falling asleep', 'wake up at night', 'wake up tired', 'snore'] },
      { key: 'stress', label: 'Stress', type: 'choice', options: ['low', 'medium', 'high'] },
      // A Brotocol in waiting (Chris, 2026-09-23); here from Most days since
      // 2026-09-24, so it is not asked again every block.
      { key: 'teethBrush', label: 'Brush your teeth', type: 'choice', options: ['once a day', 'twice a day', 'more'] },
      { key: 'teethFloss', label: 'Floss', type: 'choice', options: ['never', 'sometimes', 'every day'] },
      // No hint (Chris removed it, 2026-09-24).
      { key: 'ancillariesYes', label: 'Are you on anything prescribed?', type: 'yesno' }
    ] },
    // Shown only after a yes above: what the ancillary rules need (methods
    // section 6b). Any number of medications (Chris, 2026-09-24): tap each,
    // and each gets its own form, dose, how often, how long and side
    // effects. Who prescribes it and the next appointment are not asked.
    { title: 'Your prescription', when: { key: 'ancillariesYes', is: 'yes' },
      hint: 'We will never recommend changes to meds. We need to know so your plan works around it.',
      fields: [
        { key: 'rxMeds', label: 'What are you on?', type: 'multi', options: RX_MEDS.map(function (m) { return m.name; }) }
      ].concat(RX_MEDS.reduce(function (all, m) { return all.concat(rxFields(m)); }, [])) },
    // Everything The Brofessor puts in a client's hands (methods 4b, 4c, 6c),
    // as one set of chips (Chris, 2026-09-24); the MyFitnessPal note sits
    // under them. The line under the title is Chris's.
    { title: 'Tools', hint: 'None are required to start.', fields: [
      // No "none of these" (Chris, 2026-09-24): nothing tapped means nothing.
      // The chips sit under four small headings (`groups`; Chris found one
      // block of 22 too busy on his phone). `options` is every chip in order.
      { key: 'tools', label: 'What do you have now?', type: 'multi', groups: TOOL_GROUPS,
        options: TOOL_GROUPS.reduce(function (all, g) { return all.concat(g.options); }, []) },
      { key: 'toolsOpen', label: 'Willing to buy tools if the plan calls for them?', type: 'yesno' }
    ] },
    { title: 'Music', hint: 'The Brofessor can make music suggestions for your sessions.', fields: [
      // Chris's wording, 2026-09-23.
      // Buttons, YouTube Music added; the genres as chips; artists and songs
      // in one box, the only typing that does real work (Chris, 2026-09-24).
      { key: 'musicService', label: 'What music service do you use?', type: 'choice',
        options: ['Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music', 'something else', 'I raw dog training'] },
      // "I raw dog training" means no music: the rest of the page steps aside.
      { key: 'musicType', label: 'What do you train to?', type: 'multi',
        options: ['hip hop', 'rock', 'metal', 'country', 'house or techno', 'EDM', 'pop', 'Latin', 'classic rock', 'R&B'],
        unless: { key: 'musicService', is: 'I raw dog training' } },
      { key: 'musicFavs', label: 'Artists and songs you train to', type: 'textarea',
        hint: 'Snoop Dogg, Lil Wayne. Hype song: Dusted ’N’ Disgusted',
        unless: { key: 'musicService', is: 'I raw dog training' } },
      { key: 'cleanOnly', label: 'Clean versions only?', type: 'yesno',
        unless: { key: 'musicService', is: 'I raw dog training' } }
    ] }
  ];

  // Every page ends with one optional box for what the taps missed (Chris,
  // 2026-09-24). Pages that word their own (Goals, Your work day) keep it;
  // the rest get this one, under a key fixed here so answers keep their name.
  var MORE_KEYS = {
    'Personal Info': 'personalMore', 'Your days off': 'offMore', 'Most days': 'mostMore', 'Training': 'trainingMore',
    'Health': 'healthMore', 'Your prescription': 'rxMore', 'Tools': 'toolsMore', 'Music': 'musicMore'
  };
  INTAKE_SECTIONS.forEach(function (s) {
    if (!MORE_KEYS[s.title] || s.fields.some(function (f) { return f.key === MORE_KEYS[s.title]; })) return;
    s.fields.push({ key: MORE_KEYS[s.title], label: 'Anything else?', type: 'textarea', hint: 'Anything the taps missed' });
  });

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
        .map(function (f) {
          var val = f.type === 'time' ? clean(a[f.key])
            : f.type === 'height' ? heightWords(a[f.key])
            : f.type === 'multi' ? picksOf(a[f.key]).join(', ') : clean(a[f.key]);
          return f.label + ': ' + val;
        });
      // A gone key prints under its section: always for a section that no
      // longer asks it, and for a routine section only where the new key
      // it replaces was left blank (a version-1 bed time under a re-answer).
      // `always` prints it whatever was answered since (an activity level has
      // no new key standing in for it); `when` hides a follow-up whose own
      // question was answered No (CTO, 2026-09-24).
      Object.keys(INTAKE_LEGACY).forEach(function (k) {
        var L = INTAKE_LEGACY[k];
        if (L.section !== sec.title || blank(a[k])) return;
        if (L.when && !whenMet(L.when, a)) return;
        if (sec.routine && !L.always && !(L.replaces && blank(a[L.replaces]))) return;
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
    // An old answer stands only while its page does: the old typed
    // prescription goes after a No, like the new one (2026-09-24).
    var shownTitles = visibleSections(a).map(function (s) { return s.title; });
    Object.keys(INTAKE_LEGACY).forEach(function (k) {
      var sec = INTAKE_LEGACY[k].section;
      var known = INTAKE_SECTIONS.some(function (s) { return s.title === sec; });
      var L = INTAKE_LEGACY[k];
      if (L.when && !whenMet(L.when, a)) return;   // an old follow-up after its No
      if (!blank(a[k]) && (!known || shownTitles.indexOf(sec) >= 0)) keep[k] = a[k];
    });
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
    return (sections || INTAKE_SECTIONS).filter(function (s) { return !s.when || whenMet(s.when, a); });
  }

  // The picks of a `multi` answer: one per line.
  function picksOf(v) {
    return blank(v) ? [] : String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // A `when` clause: `is` (the answer is exactly that), `above` (a number
  // over another answer's number: goal weight over current weight), or
  // `picked`: true for anything tapped in a multi other than `except`, or a
  // list for any one of those picks.
  function whenMet(w, a) {
    if (w.above) {
      var x = parseFloat(a[w.key]), y = parseFloat(a[w.above]);
      return !isNaN(x) && !isNaN(y) && x > y;
    }
    if (w.atLeast) { var n = parseFloat(a[w.key]); return !isNaN(n) && n >= w.atLeast; }
    if (Array.isArray(w.picked)) return picksOf(a[w.key]).some(function (p) { return w.picked.indexOf(p) >= 0; });
    if (w.picked) return picksOf(a[w.key]).some(function (p) { return p !== w.except; });
    return a[w.key] === w.is;
  }

  // The fields of a section a client sees now: a `when` field appears only
  // once its question is answered that way, and an `unless` field goes away
  // when it is. A yes/no field's options are always yes and no.
  function visibleFields(section, answers) {
    var a = answers || {};
    return section.fields.filter(function (f) {
      if (f.when && !whenMet(f.when, a)) return false;
      if (f.also && !whenMet(f.also, a)) return false;   // a second condition
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
    // The tapped answers (2026-09-24) fill the same slots the typed ones
    // did, in words the day strip and the coach read: '5:30am', '7:15am,
    // 8am to 5pm'. A slot with nothing tapped falls back to the typed answer.
    // A wheel's time is stored in words already ('10:30pm', see clockWords),
    // so it reads as it is, and a typed '10:30' is never turned into morning.
    var t = function (key) { return blank(a[key]) ? '' : String(a[key]).trim(); };
    var list = function (key) { return picksOf(a[key]).join(', '); };
    var or = function (built, key, legacy) { return built || pick(key, legacy); };
    var day = function (p) {
      // '7am at home, 11am at work': the meals they said they eat, in order.
      var count = parseFloat(a[p + 'MealCount']);
      var meals = [];
      for (var i = 1; i <= MAX_MEALS && !isNaN(count) && i <= count; i++) {
        var at = t(p + 'Meal' + i), where = t(p + 'Meal' + i + 'Where');
        // '7am at home', '11am at work', '6pm out'.
        if (at || where) meals.push([at, where && (where === 'out' ? 'out' : 'at ' + where)].filter(Boolean).join(' '));
      }
      var train = [t(p + 'Train'), t(p + 'Train2')].filter(Boolean).join(', or ');
      return {
        wake: t(p + 'Wake'), meals: meals.join(', '),
        train: train, evening: list(p + 'Evening'), bed: t(p + 'Bed')
      };
    };
    var w = day('work'), o = day('off');
    var hours = [t('workStart'), t('workEnd')].filter(Boolean).join(' to ');
    // 'Fri, Sat; 10 or more on the biggest night', '3 a day, the last at noon'.
    var nights = list('alcoholNights');
    var drinks = nights === 'none' ? 'none'
      : [nights, t('alcoholMost') && t('alcoholMost') + ' on the biggest night'].filter(Boolean).join('; ');
    var last = t('caffeineLast');
    var caffeine = t('caffeineCount') ? t('caffeineCount') + ' a day' + (last && t('caffeineCount') !== '0' ? ', the last ' + (last === 'noon' ? 'at noon' : 'in the ' + last) : '') : '';
    var b = {
      version: v,
      job: pick('job'), activity: pick('activity'), workDays: list('workDays'),
      work: { wake: or(w.wake, 'workWake', 'wakeTime'), hours: or(hours, 'workHours'), meals: or(w.meals, 'workMeals'),
              train: or(w.train, 'workTrain'), evening: or(w.evening, 'workEvening'), bed: or(w.bed, 'workBed', 'bedTime') },
      off: { wake: or(o.wake, 'offWake'), meals: or(o.meals, 'offMeals'), train: or(o.train, 'offTrain'),
             evening: or(o.evening, 'offEvening'), bed: or(o.bed, 'offBed') },
      most: { steps: pick('steps'), water: pick('water'), alcohol: or(drinks, 'alcohol'), caffeine: or(caffeine, 'caffeine') },
      habitKeep: pick('habitKeep'), habitBreak: pick('habitBreak'), obstacle: pick('obstacle'),
      // Who cooks, and what the routine pages' own boxes add, so the coach
      // reads them with the routine (CTO, 2026-09-24).
      cooks: pick('workCooks'),
      notes: { work: pick('workMore'), off: pick('offMore'), most: pick('mostMore') }
    };
    b.empty = ![b.work, b.off, b.most].some(function (g) {
      return Object.keys(g).some(function (k) { return g[k] !== ''; });
    });
    return b;
  }

  // A time from the phone's wheel ('17:30') in words ('5:30pm'), which is
  // how the app stores it: a stored answer then says am or pm, and never
  // looks like a typed '10:30' that meant the evening. Anything else comes
  // back as it was, trimmed. hhmm() turns it back for the wheel.
  function clockWords(v) {
    var s = String(v == null ? '' : v).trim();
    // Two-digit hours only: the wheel always sends '05:30', and a typed
    // '5:30' could be either end of the day, so it is left as typed.
    var m = /^(\d{2}):(\d{2})$/.exec(s);
    if (!m) return s;
    var h = Number(m[1]), mm = Number(m[2]);
    if (h > 23 || mm > 59) return s;
    if (h === 12 && mm === 0) return 'noon';
    if (h === 0 && mm === 0) return 'midnight';
    return (h % 12 || 12) + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + (h >= 12 ? 'pm' : 'am');
  }

  // A stored time back to what the wheel shows ('5:30pm' -> '17:30'); ''
  // when it cannot be read (a typed answer the wheel cannot show).
  function hhmm(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/(am|pm|noon|midnight)$/i.test(s)) return /^\d{2}:\d{2}$/.test(s) ? s : '';
    var min = timeFromText(s);
    if (min === null) return '';
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // The slots of a baseline, by flat key, and how a change in each is named.
  var SLOT_LABELS = {
    workDays: 'Your work day: Work days', job: 'Your work day: Work', activity: 'Your work day: How active',
    workWake: 'Your work day: Wake', workHours: 'Your work day: Leave, work and commute', workMeals: 'Your work day: Meals',
    workTrain: 'Your work day: Could train', workEvening: 'Your work day: Evening', workBed: 'Your work day: Bed',
    offWake: 'Your days off: Wake', offMeals: 'Your days off: Meals', offTrain: 'Your days off: Could train',
    offEvening: 'Your days off: Evening', offBed: 'Your days off: Bed',
    steps: 'Most days: Steps', water: 'Most days: Water', alcohol: 'Most days: Alcohol', caffeine: 'Most days: Caffeine'
  };

  // A baseline as one flat object keyed by the version 2 field keys.
  function flatBaseline(b) {
    var out = { workDays: b.workDays || '', job: b.job, activity: b.activity, steps: b.most.steps, water: b.most.water, alcohol: b.most.alcohol, caffeine: b.most.caffeine };
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
    // Slot by slot, not field by field: a tapped answer and a typed one fill
    // the same slot, and one slot (the work hours) is built from four taps.
    var b = flatBaseline(routineBaseline(before)), a = flatBaseline(routineBaseline(after));
    var TIMED = /^(work|off)(Wake|Hours|Meals|Train|Bed)$/;
    return Object.keys(SLOT_LABELS).filter(function (k) {
      return TIMED.test(k) ? !sameSlot(k, b[k], a[k]) : b[k] !== a[k];
    })
      .map(function (k) { return { key: k, label: SLOT_LABELS[k], from: b[k], to: a[k] }; });
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

  // Every clock time in a slot's words, in order: '7am at home, 11am at
  // work' gives two; '5:30 pm, or 6 am' gives two. Each part is read by
  // timeFromText; parts with no time are skipped.
  function timesOf(text) {
    return String(text || '').split(/[,;\n]|\band\b|\bthen\b|\bor\b|\bto\b/i)
      .map(function (part) { return timeFromText(part); })
      .filter(function (t) { return t !== null; });
  }

  // Whether two answers for one routine slot say the same times (CTO,
  // 2026-09-24): a typed '5:30' and a tapped '5:30am' are the same wake time,
  // and a typed '8 to 5' and a tapped '8am to 5pm' the same hours. Times are
  // compared on a 12-hour clock, since a typed answer seldom says am or pm and
  // nobody's routine moves by exactly twelve hours. Work hours compare their
  // start and end only (the typed answer also carried the leave time). When
  // either side has no time to read, the words are compared instead.
  function sameSlot(key, before, after) {
    if (before === after) return true;
    var a = timesOf(before), b = timesOf(after);
    if (!a.length || !b.length) return false;
    if (key === 'workHours') { a = a.slice(-2); b = b.slice(-2); }
    if (a.length !== b.length) return false;
    return a.every(function (t, i) { return t % 720 === b[i] % 720; });
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
  function checklistChanged(before, after, today) {
    var day = today || todayLocal();
    // The time in force today: a step starting later is not a change yet.
    var key = function (it) { return it.id + '|' + dueByOn(it, day); };
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
    // Tapped goals take the term "By when?" gives them (3 months is the
    // next stretch; 6 months or a year is long); the client's own words in
    // the page's box each become a goal too (CTO, 2026-09-24).
    var by = String(a.goalBy || '');
    var tapped = /6 months|1 year/.test(by) ? 'long' : by === '3 months' ? 'short' : '';
    return normalizeGoals(mk(a.goals, tapped).concat(mk(a.goalsMore), mk(a.shortGoals, 'short'), mk(a.longGoals, 'long')));
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
      why: picksOf(answers.whyNow).join(', ')
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

  // `opts.planStart`: the client's plan start, when the caller knows it.
  function validateDraft(raw, opts) {
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
      if (it.swap !== undefined && !(posInt(it.swap) && posInt(it.swap) === it.swap)) {
        errors.push(who + ': swap "' + it.swap + '" is not a whole number from 1.');
      }
      if (it.replaces !== undefined && (typeof it.replaces !== 'string' || it.replaces.length > MAX_REPLACES)) {
        errors.push(who + ': replaces must be text under ' + MAX_REPLACES + ' characters.');
      }
      if (it.steps !== undefined) {
        if (!Array.isArray(it.steps) || !it.steps.length) errors.push(who + ': steps must be a list.');
        else {
          if (minutesOfDay(it.dueBy) === null) errors.push(who + ': a moving target needs its first time in dueBy.');
          it.steps.forEach(function (s, j) {
            if (!s || !posInt(s.swap) || posInt(s.swap) !== s.swap) errors.push(who + ': step ' + (j + 1) + ' needs a swap number from 1.');
            if (!s || minutesOfDay(s.dueBy) === null) errors.push(who + ': step ' + (j + 1) + ' needs a 24-hour HH:MM dueBy.');
          });
        }
      }
    });

    var stepErrors = validateDraftSteps(parsed, opts);
    errors = errors.concat(stepErrors);

    if (errors.length) return { ok: false, errors: errors, items: [], goals: [] };
    var block = posInt(parsed.block) || 1;
    var goals = normalizeGoals((parsed.goals || []).map(function (g) {
      return g && typeof g === 'object' && g.measure ? Object.assign({}, g, { block: block }) : g;
    }));
    return {
      ok: true, errors: [],
      // An item names its goal by key; the key is its goalId (goals brief 4k.4).
      items: normalizeItems(parsed.items.map(function (it) {
        var o = Object.assign({}, it, { block: block });
        if (it.goal !== undefined) o.goalId = goalKeyOf(it.goal);
        delete o.goal;
        return o;
      })),
      goals: goals,
      block: block,
      budget: normalizeBudget(parsed.budget),
      profile: parsed.profile || {}
    };
  }

  var BUDGET_DAYS = ['work', 'off'];
  // The most a week may move the scale, from the methods file (section 2):
  // a loss by how much there is to lose (over 50 lb, 2 lb a week; 20 to 50,
  // about 1; under 20, 0.5, up to 0.75 in the test-prep rate check), a gain
  // of half a percent of body weight. A goal whose measure gives a
  // `rateReason` (a GLP-1, a test date) is let through: the Brofessor has said
  // why, and Chris reads it.
  var MAX_GAIN_PER_WEEK = 0.005;
  function maxLossPerWeek(toLose) { return toLose > 50 ? 2 : toLose >= 20 ? 1 : 0.75; }

  // How often an item can be ticked in a week.
  function timesAWeek(it) {
    if (!it) return 0;
    if (it.freq === 'weekly') return Array.isArray(it.days) ? it.days.length : 0;
    if (it.freq === 'flexible') return posInt(it.timesPerWeek) || 1;
    if (it.freq === 'monthly') return 1;
    return 7;
  }

  function normalizeBudget(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (b) { return b && BUDGET_DAYS.indexOf(b.day) !== -1; }).map(function (b) {
      return { day: b.day, need: posInt(b.need), found: posInt(b.found),
        from: b.from == null ? '' : String(b.from), cut: b.cut == null ? '' : String(b.cut) };
    });
  }

  // The checks for goals with steps and for swaps (goals brief 4b, 4i).
  // Drafts written before them carry none of these fields and pass as before.
  function validateDraftSteps(parsed, opts) {
    opts = opts || {};
    var errors = [];
    var items = parsed.items || [];
    var goals = Array.isArray(parsed.goals) ? parsed.goals : [];
    // The plan's start: given by the caller, or, for a first block, about
    // now. A later block without one skips the checks that need it.
    var planStart = opts.planStart || ((posInt(parsed.block) || 1) === 1 ? (opts.today || todayLocal()) : null);
    if (parsed.block !== undefined && !(posInt(parsed.block) && posInt(parsed.block) === parsed.block)) {
      errors.push('block "' + parsed.block + '" is not a whole number from 1.');
    }

    // Swaps number from 1 with no gaps and no repeats, across items and the
    // steps of moving targets.
    var nums = [];
    items.forEach(function (it) {
      if (it && posInt(it.swap)) nums.push(posInt(it.swap));
      if (it && Array.isArray(it.steps)) it.steps.forEach(function (s) { if (s && posInt(s.swap)) nums.push(posInt(s.swap)); });
    });
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    sorted.forEach(function (n, i) {
      if (n !== i + 1) errors.push('Swaps must be numbered 1 to ' + sorted.length + ' with no gaps or repeats; found ' + sorted.join(', ') + '.');
    });
    if (errors.length > 1) errors = errors.filter(function (e, i, a) { return a.indexOf(e) === i; });

    // The time budget: needed when there are swaps, and it must add up.
    if (nums.length) {
      if (!Array.isArray(parsed.budget) || !parsed.budget.length) errors.push('A draft with swaps needs a "budget": the minutes the plan needs and found, for a work day and a day off.');
      else parsed.budget.forEach(function (b, i) {
        var who = 'budget ' + (i + 1);
        if (!b || BUDGET_DAYS.indexOf(b.day) === -1) { errors.push(who + ': day must be "work" or "off".'); return; }
        if (!posInt(b.need) || posInt(b.found) !== Number(b.found)) errors.push(who + ' (' + b.day + '): need and found are minutes, whole numbers.');
        else if (posInt(b.found) < posInt(b.need) && !String(b.cut || '').trim()) {
          errors.push(who + ' (' + b.day + '): found ' + b.found + ' min is less than the ' + b.need + ' min needed. Shrink the program and say what was cut in "cut".');
        }
      });
    }

    // Goals with a measure.
    var keys = {};
    goals.forEach(function (g) {
      if (!g || typeof g !== 'object' || !g.measure) return;
      var name = '"' + (g.text || 'a goal') + '"';
      var key = goalKeyOf(g.key);
      if (!key) { errors.push('Goal ' + name + ' needs a key: a short name in lower case, like "weight" or "sleep".'); return; }
      if (keys[key]) errors.push('Two goals share the key "' + key + '".');
      keys[key] = g;
      var m = g.measure;
      if (MEASURES.indexOf(m.kind) === -1) { errors.push('Goal ' + name + ': measure kind "' + m.kind + '" is not one of ' + MEASURES.join(', ') + '.'); return; }
      if (!g.why || !String(g.why).trim()) errors.push('Goal ' + name + ' needs a "why", in the client’s own words.');
      if (!/^\d{4}-\d\d-\d\d$/.test(String(m.by || ''))) errors.push('Goal ' + name + ' needs a date in measure.by (YYYY-MM-DD).');
      var months = Array.isArray(g.months) ? g.months : [];
      var weeks = Array.isArray(g.weeks) ? g.weeks : [];
      if (!months.length) errors.push('Goal ' + name + ' needs its monthly steps.');

      if (NUMERIC_MEASURES.indexOf(m.kind) !== -1) {
        var start = numOrNull(m.start), target = numOrNull(m.target);
        if (start === null || target === null) { errors.push('Goal ' + name + ' needs a start and a target number.'); return; }
        var rises = target > start, prev = start;
        months.forEach(function (s) {
          var t = numOrNull(s && s.target);
          if (t === null) { errors.push('Goal ' + name + ': month ' + (s && s.n) + ' needs a target number.'); return; }
          if (rises ? t < prev : t > prev) errors.push('Goal ' + name + ': month ' + s.n + ' (' + t + ') goes the wrong way.');
          prev = t;
        });
        if (months.length && Math.abs(numOrNull(months[months.length - 1].target) - target) > 0.01) {
          errors.push('Goal ' + name + ': the last month must reach the target, ' + target + '.');
        }
        if (m.kind === 'weight') {
          if (weeks.length !== 4 || weeks.some(function (s, i) { return !s || s.n !== i + 1 || numOrNull(s.target) === null; })) {
            errors.push('Goal ' + name + ' needs four weekly steps, weeks 1 to 4, each with a target.');
          }
          // The pace over the weeks to the goal's date when the plan's start
          // is known, else over the months given.
          var span = planStart && /^\d{4}-\d\d-\d\d$/.test(String(m.by || '')) ? daysBetween(planStart, m.by) / 7 : months.length * 4;
          var perWeek = span > 0 ? Math.abs(target - start) / span : Infinity;
          var limit = rises ? start * MAX_GAIN_PER_WEEK : maxLossPerWeek(start - target);
          if (perWeek > limit + 0.005 && !String(m.rateReason || '').trim()) {
            errors.push('Goal ' + name + ': ' + (isFinite(perWeek) ? Math.round(perWeek * 100) / 100 : 'no time') + ' lb a week is faster than the methods file allows (' +
              (Math.round(limit * 100) / 100) + ' lb a week). Give it more time or a smaller target, or say why in measure.rateReason.');
          }
        }
      }
      // The months reach the goal's date: the last one ends within four weeks
      // of it. Checked when the plan's start is known (block 1 starts about now).
      if (planStart && months.length && /^\d{4}-\d\d-\d\d$/.test(String(m.by || ''))) {
        var lastEnd = addDays(planStart, BLOCK_DAYS * months.length - 1);
        if (Math.abs(daysBetween(lastEnd, m.by)) >= BLOCK_DAYS) {
          errors.push('Goal ' + name + ': ' + months.length + ' monthly steps end on ' + lastEnd + ', not near its date, ' + m.by + '. One step every four weeks to the date.');
        }
      }
      if (m.kind === 'habit') {
        if (!weeks.length) errors.push('Goal ' + name + ' needs its weekly steps, each naming a swap.');
        weeks.forEach(function (s) {
          if (!s || nums.indexOf(posInt(s.swap)) === -1) { errors.push('Goal ' + name + ': a weekly step names swap ' + (s && s.swap) + ', which is not in this draft.'); return; }
          var its = items.filter(function (it) {
            return it && (posInt(it.swap) === s.swap || (Array.isArray(it.steps) && it.steps.some(function (x) { return x && posInt(x.swap) === s.swap; })));
          });
          var most = its.reduce(function (mx, it) { return Math.max(mx, timesAWeek(normalizeItem(it))); }, 0);
          if (!posInt(s.target) || s.target > most) {
            errors.push('Goal ' + name + ': swap ' + s.swap + '’s target must be 1 to ' + most + ' days, as often as its item can be ticked.');
          }
        });
      }
      if (m.kind === 'fit') {
        if (FIT_SCALE.indexOf(m.target) === -1) errors.push('Goal ' + name + ': a clothes goal’s target is one of ' + FIT_SCALE.join(', ') + '.');
        months.concat(weeks).forEach(function (s) {
          if (!s || FIT_SCALE.indexOf(s.target) === -1) errors.push('Goal ' + name + ': each step’s target is one of ' + FIT_SCALE.join(', ') + '.');
        });
      }
    });

    // Items point at real goals, and every goal with a measure has items.
    items.forEach(function (it, i) {
      if (it && it.goal !== undefined && !keys[goalKeyOf(it.goal)]) {
        errors.push(draftLabel(it, i) + ': goal "' + it.goal + '" is not the key of a goal with a measure in this draft.');
      }
    });
    Object.keys(keys).forEach(function (k) {
      if (!items.some(function (it) { return it && goalKeyOf(it.goal) === k; })) {
        errors.push('Goal "' + (keys[k].text || k) + '" has no items. Tie at least one with "goal": "' + k + '".');
      }
    });
    return errors;
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
      var diffs = ['core', 'freq', 'dueBy', 'group', 'notes', 'trainerNotes', 'goalId', 'swap', 'block', 'replaces', 'steps'].filter(function (f) {
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
    // w3: the intro paragraph cut (Chris, 2026-09-23: too many words on a phone).
    version: 'w3-2026-09-23',
    title: 'Welcome to Beast Mode',
    tagline: 'Unleash the Beast, one habit at a time',
    intro: '',
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

  // The level-up's words (STARTS): each badge's name and line, and The
  // Brofessor's shout-out after his opener. No mention of points before a
  // plan. All Chris's wording, approved 2026-09-24.
  var STARTS_WORDING = {
    install: { title: 'Home screen', text: 'Beast Mode on your home screen' },
    intake: { title: 'Intake done', text: 'The whole picture, handed over' },
    heading: 'Badges',
    // Its own message from The Brofessor, after the opener. Chris's wording,
    // 2026-09-24.
    // Only for both badges: a client who never put the app on the home
    // screen gets the badge and no shout (Chris, 2026-09-24: the web app
    // outside the home screen does not work right; see the native app).
    shout: 'BANG!! It looks like you already got the app on your home screen and finished your intake! ' +
      'WELL DONE!! Bonus points and a sick plan are yours.'
  };

  // The Brofessor's first message in the chat, once the welcome is done.
  // One clause differs by the answer to CONSENTS[2]. Chris's wording.
  var COACH_OPENER = {
    learning: 'Welcome to coaching. I’m The Brofessor, your guide to SHREDZVILLE. We are going to get along great ' +
      '(if you listen to everything I say) LOL!!! A few quick reminders before we go: our chats are saved and a human coach ' +
      'reads them. You’re letting me learn from them so I can coach you better. You can change your choices in Profile, any time. ' +
      'If you’re ever in a crisis, call or text 988. Now, what are we working on?',
    notLearning: 'Welcome to coaching. I’m The Brofessor, your guide to SHREDZVILLE. We are going to get along great ' +
      '(if you listen to everything I say) LOL!!! A few quick reminders before we go: our chats are saved and a human coach ' +
      'reads them. You’ve kept them out of my training, which is fine by me. You can change your choices in Profile, any time. ' +
      'If you’re ever in a crisis, call or text 988. Now, what are we working on?'
  };

  // The newest answer on file counts only if it was given to today's wording.
  // `given` is the server's record: { version, answer, at } or null.
  function consentStands(kind, given) {
    var c = CONSENTS[kind];
    return !!(c && given && given.version === c.version &&
      (given.answer === 'yes' || (kind === 2 && given.answer === 'no')));
  }

  /* What the server has on file for a client (POST /welcome/on-file) is a
     finished welcome only if all four answers stand for today's wording:
     consents 1 and 2 at their versions, and the sharing and reminder answers
     recorded with this welcome's version. Anything short of that asks again.
     A phone opening a plan with nothing held uses this to skip a welcome the
     client already answered elsewhere (Chris, 2026-09-24). */
  function welcomeOnFile(data) {
    if (!data || typeof data !== 'object' || !data.consent) return false;
    var at = function (a) { return !!a && typeof a === 'object' && a.version === WELCOME.version && typeof a.on === 'boolean'; };
    return consentStands(1, data.consent[1]) && consentStands(2, data.consent[2]) && at(data.sharing) && at(data.nudges);
  }

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    VERSION: VERSION,
    PAYLOAD_VERSION: PAYLOAD_VERSION,
    KINDS: KINDS, FREQS: FREQS, METRICS: METRICS, TIMINGS: TIMINGS, DAYS: DAYS,
    TIMING_LABELS: TIMING_LABELS, timingLabel: timingLabel,
    WEIGHT_UNIT: WEIGHT_UNIT, itemSummary: itemSummary,
    MIN_AGE: MIN_AGE, ageOn: ageOn, isUnderAge: isUnderAge, ageUnknown: ageUnknown, missingRequired: missingRequired, picksOf: picksOf, clockWords: clockWords, hhmm: hhmm, songOf: songOf, songSearchUrl: songSearchUrl, appleSongLookupUrl: appleSongLookupUrl, appleSongLink: appleSongLink, answersThatFit: answersThatFit, nameParts: nameParts, inchesOf: inchesOf, feetInchesOf: feetInchesOf, heightWords: heightWords,
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
    packItem: packItem, unpackItem: unpackItem, shareUrlLength: shareUrlLength, linkFromText: linkFromText, needsInstallFirst: needsInstallFirst, heldWelcomeFits: heldWelcomeFits, welcomeOnFile: welcomeOnFile, STARTS: STARTS, STARTS_WORDING: STARTS_WORDING, startPoints: startPoints, heldStartsFit: heldStartsFit, welcomeStamp: welcomeStamp, iosSafari: iosSafari, hasAppHistory: hasAppHistory,
    validateDraft: validateDraft, mergeDraft: mergeDraft,
    // Goals with steps and finding the time (goals brief, draft 3).
    PACES: PACES, DEFAULT_PACE: DEFAULT_PACE, MEASURES: MEASURES, FIT_SCALE: FIT_SCALE, BLOCK_DAYS: BLOCK_DAYS,
    WEIGHT_MARGIN: WEIGHT_MARGIN, PAYLOAD_STEPS: PAYLOAD_STEPS, STATUS_MAX_STEPS: STATUS_MAX_STEPS,
    paceOf: paceOf, startWeekFor: startWeekFor, blockStartOf: blockStartOf, scheduleSwaps: scheduleSwaps, dueByOn: dueByOn,
    goalKeyOf: goalKeyOf, goalLink: goalLink, mergeGoals: mergeGoals,
    stepKey: stepKey, stepValue: stepValue, stepPoints: stepPoints, judgeSteps: judgeSteps, unsentSteps: unsentSteps,
    ladderWeek: ladderWeek, ladderSnapshot: ladderSnapshot, rankProgress: rankProgress, validateSteps: validateSteps,
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
