/* ==========================================================================
   Beast Mode Core
   --------------------------------------------------------------------------
   The shared data contract for trainer-dashboard.html and index.html.

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
  var VERSION = '2.0.0';

  // Payload schema version. An app receiving a higher number refuses the
  // import instead of guessing at a shape it does not know.
  var PAYLOAD_VERSION = 2;

  // ── Vocabulary ────────────────────────────────────────────────────────────

  var KINDS = ['exercise', 'supplement', 'habit'];
  var FREQS = ['daily', 'weekly', 'flexible', 'monthly'];

  var METRICS = ['sets_reps', 'sets_reps_weight', 'time', 'distance', 'reps', 'notes'];

  // Which numbers a metric asks for, in display order. Both apps read this
  // rather than hardcoding field names, so a new metric is a one-line change
  // here instead of an edit in three files.
  var TARGET_FIELDS = {
    sets_reps:        [{ key: 'sets', label: 'Sets' }, { key: 'reps', label: 'Reps' }],
    sets_reps_weight: [{ key: 'sets', label: 'Sets' }, { key: 'reps', label: 'Reps' }, { key: 'weight', label: 'Weight' }],
    time:             [{ key: 'minutes', label: 'Minutes' }],
    distance:         [{ key: 'distance', label: 'Distance' }],
    reps:             [{ key: 'reps', label: 'Reps' }],
    notes:            []
  };

  var METRIC_LABELS = {
    sets_reps: 'Sets and reps', sets_reps_weight: 'Sets, reps and weight',
    time: 'Time', distance: 'Distance', reps: 'Reps', notes: 'Notes only'
  };

  function metricLabel(metric) { return METRIC_LABELS[metric] || metric; }
  function targetFields(metric) { return TARGET_FIELDS[metric] || []; }

  // "3 x 12 @ 135" / "20 min" / "" when nothing is set.
  function formatTarget(detail) {
    if (!detail || !detail.target) return '';
    var t = detail.target;
    switch (detail.metric) {
      case 'sets_reps':
        return (t.sets && t.reps) ? t.sets + ' x ' + t.reps : '';
      case 'sets_reps_weight':
        if (!t.sets || !t.reps) return '';
        return t.sets + ' x ' + t.reps + (t.weight ? ' @ ' + t.weight : '');
      case 'time':     return t.minutes ? t.minutes + ' min' : '';
      case 'distance': return t.distance ? String(t.distance) : '';
      case 'reps':     return t.reps ? t.reps + ' reps' : '';
      default:         return '';
    }
  }

  var TIMINGS = [
    'morning', 'pre_workout', 'post_workout',
    'with_breakfast', 'with_lunch', 'with_dinner', 'evening', 'bedtime'
  ];

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
  var DEFAULT_CORE_BY_KIND = {
    exercise: false,
    supplement: false,
    habit: true
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
  function dayResult(items, log, ymd) {
    var core = scheduledCoreOn(items, ymd);
    var gate = 'neutral';
    if (core.length) {
      gate = core.every(function (it) {
        return isSameDay(entryFor(log, it.id, ymd), ymd);
      }) ? 'closed' : 'broken';
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

  // ── Payload codec ─────────────────────────────────────────────────────────

  var PREFIXES = { setup: 'BMNEW', plan: 'BMPLAN', report: 'BMREPORT', ask: 'BMASK', intake: 'BMINTAKE' };

  // is.gd rejects a long URL past about 5,000 characters and TinyURL is no
  // more generous. A 40-item plan sits close enough to matter, so the trainer
  // app warns before it tries to shorten.
  var SHARE_LIMITS = { maxUrl: 5000, warnUrl: 4500 };

  function shareUrlLength(baseUrl, code) {
    return String(baseUrl).length + '#import='.length + String(code).length;
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
        return { ok: false, error: 'That link is damaged. Ask Chris to send a new one.' };
      }
      if (!json) return { ok: false, error: 'That link is damaged. Ask Chris to send a new one.' };

      var data;
      try { data = JSON.parse(json); }
      catch (e) { return { ok: false, error: 'That link is damaged. Ask Chris to send a new one.' }; }

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

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    VERSION: VERSION,
    PAYLOAD_VERSION: PAYLOAD_VERSION,
    KINDS: KINDS, FREQS: FREQS, METRICS: METRICS, TIMINGS: TIMINGS, DAYS: DAYS,
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

    dayResult: dayResult, programStart: programStart,
    currentStreak: currentStreak, bestStreak: bestStreak,
    totalPoints: totalPoints, perfectWeek: perfectWeek,
    levelThresholds: levelThresholds, levelFor: levelFor, progress: progress,

    encodePayload: encodePayload, decodePayload: decodePayload,
    packItem: packItem, unpackItem: unpackItem, shareUrlLength: shareUrlLength
  };
})();

if (typeof module === 'object' && module.exports) module.exports = BeastCore;
