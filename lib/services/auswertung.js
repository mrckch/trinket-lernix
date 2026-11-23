'use strict';

/**
 * Anonymous evaluation of course assignments (Trinket Lernix, ADR 0008): figures per task, never
 * per person or course.
 *
 * - The same task in several courses = same name, language and starter code of its template.
 * - Only tasks whose counted children come from at least `MIN_COURSES` courses.
 * - Only trinkets of student accounts, created in the chosen school year, not in the trash.
 * - Every figure needs at least `MIN_CHILDREN` different children, otherwise "zu wenige".
 * - The result has no names, ids, courses or times. Nothing is stored; it is computed when asked.
 *
 * `evaluate(data, options)` only computes (testable without a database), `load(begin, end)` reads
 * MongoDB, `run(options)` does both.
 */

var crypto    = require('crypto'),
    mongoose  = require('mongoose'),
    retention = require('../util/retention');

var MIN_CHILDREN = 5,
    MIN_COURSES  = 2,
    DAY          = 24 * 60 * 60 * 1000,
    GONE_AFTER   = 14 * DAY,   // not submitted and nothing done oneself for this long: gave up
    WORK_GAP     = 10 * 60 * 1000, // longer pauses between two runs separate work sessions
    SUBMITTED    = ['submitted', 'submittedLate', 'completed'],
    FEW          = 'zu wenige';

var LANG_LABELS = {
  python              : 'Python',
  python3             : 'Python 3',
  console             : 'Konsole',
  music               : 'Musik',
  html                : 'HTML',
  blocks              : 'Blöcke',
  glowscript          : 'Web VPython',
  'glowscript-blocks' : 'Web VPython mit Blöcken',
  java                : 'Java',
  R                   : 'R',
  pygame              : 'Pygame'
};

// --- matching ----------------------------------------------------------------------------------

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeCode(code) {
  return String(code || '').replace(/\r\n?/g, '\n');
}

/** Key of a task: hash over name, language and starter code (ADR 0008, decision 1). */
function taskKey(name, lang, code) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([normalizeName(name), String(lang || ''), normalizeCode(code)]))
    .digest('hex');
}

// --- school year -------------------------------------------------------------------------------

var YEAR = /^(\d{4})\/(\d{2})$/;

function currentSchoolYear(now) {
  var first = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return first + '/' + String((first + 1) % 100).padStart(2, '0');
}

/** `2026/27` → 1 August 2026 up to (not including) 1 August 2027, local time like retention.js. */
function schoolYearBounds(label) {
  var found = YEAR.exec(String(label || ''));
  if (!found || (parseInt(found[1], 10) + 1) % 100 !== parseInt(found[2], 10)) {
    throw new Error('Schuljahr wie 2026/27 angeben, nicht „' + label + '“.');
  }
  var first = parseInt(found[1], 10);
  return { begin : new Date(first, 7, 1), end : new Date(first + 1, 7, 1) };
}

// --- figures -----------------------------------------------------------------------------------

function share() { return { part : 0, whole : 0 }; }

function percent(s) {
  return s.whole >= MIN_CHILDREN ? Math.round(100 * s.part / s.whole) : null;
}

/** Linear interpolation like Python's statistics.quantiles(method="inclusive"). */
function quantile(values, p) {
  var sorted = values.slice().sort(function(a, b) { return a - b; }),
      pos    = p * (sorted.length - 1),
      lower  = Math.floor(pos),
      upper  = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function median(values) {
  return values.length >= MIN_CHILDREN ? quantile(values, 0.5) : null;
}

function upperQuartile(values) {
  return values.length >= MIN_CHILDREN ? quantile(values, 0.75) : null;
}

/** Work time from run times: pauses up to `WORK_GAP` count, longer ones separate sessions. */
function workMinutes(times) {
  var sorted = times.map(Number).sort(function(a, b) { return a - b; }),
      total  = 0;
  for (var i = 1; i < sorted.length; i++) {
    var gap = sorted[i] - sorted[i - 1];
    if (gap <= WORK_GAP) total += gap;
  }
  return Math.round(total / 60000);
}

function time(value) {
  return value ? new Date(value).getTime() : 0;
}

/**
 * One child, one task, one course: working copies and submission together.
 * Returns null if the child did nothing oneself (only opened the task).
 */
function pairFigures(trinkets, runs, child) {
  var ids        = {},
      submission = null,
      modified   = false,
      lastChange = 0;

  trinkets.forEach(function(t) {
    ids[t.id] = true;
    if (SUBMITTED.indexOf(t.state) >= 0) {
      if (!submission || time(t.submittedOn) > time(submission.submittedOn)) submission = t;
    } else {
      if (t.state === 'modified') modified = true;
      lastChange = Math.max(lastChange, time(t.lastUpdated));
    }
  });

  var own = runs.filter(function(r) { return ids[r.trinket] && r.actor === child; })
                .map(function(r) { return time(r.at); });

  if (!submission && !modified && !own.length) return null;

  var result = {
    submitted  : !!submission,
    lastActive : Math.max.apply(null, [lastChange].concat(own)),
    changed    : Math.max.apply(null, trinkets.map(function(t) { return time(t.lastUpdated); }))
  };

  if (submission) {
    var until    = time(submission.submittedOn),
        before   = own.filter(function(at) { return at <= until; }),
        feedback = (submission.feedbackAt || []).map(time).filter(Boolean),
        first    = feedback.length ? Math.min.apply(null, feedback) : null;

    result.runs        = before.length;
    result.minutes     = workMinutes(before);
    result.feedback    = feedback.length > 0;
    result.resubmitted = first !== null && until > first;
    result.revision    = result.feedback && (!!submission.allowResubmit || result.resubmitted);
  }
  return result;
}

/** A child who did the same task in two courses counts once: submitted, otherwise the latest. */
function better(a, b) {
  if (a.figures.submitted !== b.figures.submitted) return a.figures.submitted ? a : b;
  return a.figures.changed >= b.figures.changed ? a : b;
}

/**
 * @param {{ tasks: Array<{id, name, lang, code}>,
 *           trinkets: Array<{id, task, course, child, state, lastUpdated, submittedOn,
 *                            feedbackAt: Date[], allowResubmit}>,
 *           runs: Array<{trinket, actor, at}> }} data  ids as strings
 * @param {{ now: Date, schoolYear?: string }} options
 */
function evaluate(data, options) {
  var now    = options.now,
      year   = options.schoolYear || currentSchoolYear(now),
      bounds = schoolYearBounds(year);

  var tasksById = {}, groups = {};
  (data.tasks || []).forEach(function(task) {
    var key = taskKey(task.name, task.lang, task.code);
    tasksById[task.id] = key;
    if (!groups[key]) groups[key] = { key : key, name : normalizeName(task.name), lang : task.lang };
  });

  var runsByTrinket = {};
  (data.runs || []).forEach(function(r) {
    (runsByTrinket[r.trinket] = runsByTrinket[r.trinket] || []).push(r);
  });

  // (task key, child, course) → trinkets
  var pairs = {};
  (data.trinkets || []).forEach(function(t) {
    var key = tasksById[t.task];
    if (!key) return;
    var id = key + '|' + t.child + '|' + t.course;
    (pairs[id] = pairs[id] || { key : key, child : t.child, course : t.course, trinkets : [] }).trinkets.push(t);
  });

  // (task key, child) → the one course that counts
  var chosen = {};
  Object.keys(pairs).forEach(function(id) {
    var pair = pairs[id],
        runs = [].concat.apply([], pair.trinkets.map(function(t) { return runsByTrinket[t.id] || []; }));
    pair.figures = pairFigures(pair.trinkets, runs, pair.child);
    if (!pair.figures) return;
    var childKey = pair.key + '|' + pair.child;
    chosen[childKey] = chosen[childKey] ? better(chosen[childKey], pair) : pair;
  });

  var goneBefore = Math.min(now.getTime(), bounds.end.getTime()) - GONE_AFTER,
      figures    = {};

  Object.keys(chosen).forEach(function(childKey) {
    var pair = chosen[childKey], p = pair.figures;
    var f = figures[pair.key] = figures[pair.key] || {
      task : groups[pair.key], courses : {}, worked : 0, submitted : share(), runs : [], minutes : [],
      revision : share(), resubmitted : share(), gone : share()
    };

    f.courses[pair.course] = true;
    f.worked += 1;
    f.submitted.whole += 1;
    f.gone.whole += 1;
    if (p.submitted) {
      f.submitted.part += 1;
      f.runs.push(p.runs);
      f.minutes.push(p.minutes);
      if (p.feedback) {
        f.revision.whole += 1;
        if (p.revision) {
          f.revision.part += 1;
          f.resubmitted.whole += 1;
          if (p.resubmitted) f.resubmitted.part += 1;
        }
      }
    } else if (p.lastActive < goneBefore) {
      f.gone.part += 1;
    }
  });

  // only tasks from at least MIN_COURSES courses, otherwise the name gives the course away
  var tasks = Object.keys(figures)
    .map(function(key) { return figures[key]; })
    .filter(function(f) { return Object.keys(f.courses).length >= MIN_COURSES; })
    .map(function(f) {
      return {
        key         : f.task.key,
        name        : f.task.name,
        lang        : f.task.lang,
        worked      : f.worked,
        submitted   : f.submitted,
        runs        : f.runs,
        minutes     : f.minutes,
        revision    : f.revision,
        resubmitted : f.resubmitted,
        gone        : f.gone
      };
    });

  return { schoolYear : year, asOf : now, tasks : tasks };
}

// --- report ------------------------------------------------------------------------------------

function number(value) {
  if (value === null || value === undefined) return FEW;
  return (Math.round(value * 10) / 10).toString().replace('.', ',');
}

function pct(s) {
  var value = percent(s);
  return value === null ? FEW : value + ' %';
}

function workedCount(count) {
  return count >= MIN_CHILDREN ? String(count) : '< ' + MIN_CHILDREN;
}

function langLabel(lang) {
  return LANG_LABELS[lang] || String(lang);
}

function date(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

/** Markdown: one table per language, one row per task. */
function report(evaluation) {
  var lines = [
    '# Auswertung der Kursaufgaben in Trinket Lernix, Schuljahr ' + evaluation.schoolYear,
    '',
    'Stand: ' + date(evaluation.asOf) + '. Nur Aufgaben, die in mindestens ' + MIN_COURSES +
      ' Kursen bearbeitet wurden, und nur Trinkets von SuS. Jede Zahl steht für mindestens ' +
      MIN_CHILDREN + ' verschiedene Kinder, sonst steht dort „' + FEW + '“. Keine Namen, keine Kurse (ADR 0008).',
    '',
    '- **Bearbeitet:** Kinder, die selbst Code geändert, ausgeführt oder abgegeben haben.',
    '- **Abgegeben:** Anteil davon mit Abgabe.',
    '- **Läufe:** eigene Läufe bis zur Abgabe (Median / oberes Viertel). Gleicher Code zählt einmal je Aufruf der Seite.',
    '- **Minuten:** Arbeitszeit bis zur Abgabe (Median), aus den Zeitpunkten der Läufe geschätzt.',
    '- **Überarbeitung verlangt:** Anteil der Abgaben mit Rückmeldung, die noch einmal bearbeitet werden sollten.',
    '- **Nachgebessert:** Anteil davon, der danach erneut abgegeben hat.',
    '- **Ausgestiegen:** nicht abgegeben und seit ' + (GONE_AFTER / DAY) + ' Tagen nichts mehr getan.'
  ];

  if (!evaluation.tasks.length) {
    lines.push('', 'Keine Aufgabe erfüllt die Bedingungen.');
    return lines.join('\n') + '\n';
  }

  // same name and language, but different tasks: add a short id so they can be told apart
  var seen = {};
  evaluation.tasks.forEach(function(t) {
    var id = t.lang + '|' + t.name;
    seen[id] = (seen[id] || 0) + 1;
  });

  var byLang = {};
  evaluation.tasks.forEach(function(t) { (byLang[t.lang] = byLang[t.lang] || []).push(t); });

  Object.keys(byLang)
    .sort(function(a, b) { return langLabel(a).localeCompare(langLabel(b), 'de'); })
    .forEach(function(lang) {
      lines.push(
        '',
        '## ' + langLabel(lang),
        '',
        '| Aufgabe | Bearbeitet | Abgegeben | Läufe | Minuten | Überarbeitung verlangt | Nachgebessert | Ausgestiegen |',
        '|---|---:|---:|---:|---:|---:|---:|---:|'
      );
      byLang[lang]
        .sort(function(a, b) { return a.name.localeCompare(b.name, 'de') || a.key.localeCompare(b.key); })
        .forEach(function(t) {
          var name  = seen[t.lang + '|' + t.name] > 1 ? t.name + ' · ' + t.key.slice(0, 6) : t.name,
              runs  = median(t.runs) === null ? FEW : number(median(t.runs)) + ' / ' + number(upperQuartile(t.runs));
          lines.push('| ' + [
            escapeCell(name), workedCount(t.worked), pct(t.submitted), runs, number(median(t.minutes)),
            pct(t.revision), pct(t.resubmitted), pct(t.gone)
          ].join(' | ') + ' |');
        });
    });

  return lines.join('\n') + '\n';
}

// --- loading -----------------------------------------------------------------------------------

function Raw(name) { return mongoose.model(name); }

function str(id) { return id ? String(id) : null; }

/** Reads what `evaluate` needs from MongoDB: only student trinkets of course assignments. */
async function load(begin, end) {
  var children = await retention.studentIds();
  if (!children.length) return { tasks : [], trinkets : [], runs : [] };

  var trinkets = await Raw('Snippet').find({
    _creator   : { $in : children },
    materialId : { $ne : null },
    courseId   : { $ne : null },
    deletedAt  : null,
    created    : { $gte : begin, $lt : end }
  }).select('materialId courseId _creator submissionState lastUpdated submittedOn comments.commentType comments.commented submissionOpts').lean();

  if (!trinkets.length) return { tasks : [], trinkets : [], runs : [] };

  var materialIds = Object.keys(trinkets.reduce(function(acc, t) { acc[str(t.materialId)] = true; return acc; }, {})),
      materials   = await Raw('Material').find({ _id : { $in : materialIds }, type : 'assignment' }).select('name trinket.trinketId').lean(),
      templateIds = materials.map(function(m) { return m.trinket && m.trinket.trinketId; }).filter(Boolean),
      templates   = await Raw('Snippet').find({ _id : { $in : templateIds } }).select('lang code').lean(),
      byTemplate  = {};

  templates.forEach(function(t) { byTemplate[str(t._id)] = t; });

  var tasks = materials
    .filter(function(m) { return m.trinket && byTemplate[str(m.trinket.trinketId)]; })
    .map(function(m) {
      var template = byTemplate[str(m.trinket.trinketId)];
      return { id : str(m._id), name : m.name, lang : template.lang, code : template.code };
    });

  var runs = await Raw('Interaction').find({
    action   : 'runs',
    _trinket : { $in : trinkets.map(function(t) { return t._id; }) }
  }).select('_trinket _actor').lean();

  return {
    tasks    : tasks,
    trinkets : trinkets.map(function(t) {
      return {
        id            : str(t._id),
        task          : str(t.materialId),
        course        : str(t.courseId),
        child         : str(t._creator),
        state         : t.submissionState,
        lastUpdated   : t.lastUpdated,
        submittedOn   : t.submittedOn || null,
        feedbackAt    : (t.comments || []).filter(function(c) { return c.commentType === 'feedback'; })
                          .map(function(c) { return c.commented; }),
        allowResubmit : !!(t.submissionOpts && t.submissionOpts.allowResubmit)
      };
    }),
    runs : runs.map(function(r) {
      return { trinket : str(r._trinket), actor : str(r._actor), at : r._id.getTimestamp() };
    })
  };
}

/** @param {{ now?: Date, schoolYear?: string }} options */
async function run(options) {
  options = options || {};
  var now    = options.now || new Date(),
      year   = options.schoolYear || currentSchoolYear(now),
      bounds = schoolYearBounds(year);

  return evaluate(await load(bounds.begin, bounds.end), { now : now, schoolYear : year });
}

module.exports = {
  MIN_CHILDREN      : MIN_CHILDREN,
  MIN_COURSES       : MIN_COURSES,
  taskKey           : taskKey,
  currentSchoolYear : currentSchoolYear,
  schoolYearBounds  : schoolYearBounds,
  workMinutes       : workMinutes,
  median            : median,
  upperQuartile     : upperQuartile,
  evaluate          : evaluate,
  report            : report,
  load              : load,
  run               : run
};
