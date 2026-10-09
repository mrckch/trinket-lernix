'use strict';

/**
 * Aufbewahrung (Trinket Lernix, Std 15 / ADR 0003).
 *
 * Entscheidung Marc (2026-10-09): SuS-Trinkets und Abgaben bleiben bis zum Schuljahresende
 * und danach 30 Tage im Papierkorb – wie bei LeFo.
 *
 * Täglicher Lauf (scripts/maintenance.js), zustandslos und wiederholbar:
 *   1. IServ-verknüpfte Kurse, die vor dem letzten Schuljahresende angelegt wurden, archivieren
 *      (keine automatische Zuordnung mehr, Inhalte bleiben für die Lehrkraft sichtbar).
 *   2. Trinkets von SuS-Konten (eigene Projekte und Abgaben), die vor dem letzten
 *      Schuljahresende entstanden sind, in den Papierkorb legen (deletedAt).
 *   3. Papierkorb leeren: alles, was länger als `trashDays` im Papierkorb liegt, endgültig
 *      löschen – samt Entwürfen und Interaktions-Log.
 */

var config   = require('config'),
    mongoose = require('mongoose');

function settings() {
  return (config.app && config.app.retention) || {};
}

function isEnabled() {
  return settings().enabled !== false;
}

function trashDays() {
  var days = Number(settings().trashDays);
  return isNaN(days) || days < 0 ? 30 : days;
}

function logger() {
  return global.log || console;
}

/** Letztes Schuljahresende (MM-DD, Default 07-31) vor oder gleich `now`, Ende des Tages. */
function lastSchoolYearEnd(now) {
  now = now || new Date();
  var parts = String(settings().schoolYearEnd || '07-31').split('-'),
      month = parseInt(parts[0], 10) - 1,
      day   = parseInt(parts[1], 10);

  if (isNaN(month) || isNaN(day)) { month = 6; day = 31; }

  var end = new Date(now.getFullYear(), month, day, 23, 59, 59, 999);
  if (end > now) {
    end = new Date(now.getFullYear() - 1, month, day, 23, 59, 59, 999);
  }
  return end;
}

/** IDs aller reinen SuS-Konten (Site-Rolle student, nicht teacher/admin). */
async function studentIds() {
  var docs = await mongoose.model('User')
    .find({ roles : { $elemMatch : { context : 'site', roles : 'student' } } })
    .select('roles')
    .lean();

  return docs.filter(function(doc) {
    var site = (doc.roles || []).filter(function(r) { return r.context === 'site'; })[0];
    return site && site.roles.indexOf('student') >= 0
      && site.roles.indexOf('teacher') < 0 && site.roles.indexOf('admin') < 0;
  }).map(function(doc) { return doc._id; });
}

async function archiveCourses(cutoff, dryRun) {
  var Course = mongoose.model('Course'),
      filter = { 'externalLink.source' : 'iserv', archived : { $ne : true }, created : { $lte : cutoff } },
      count  = await Course.countDocuments(filter);

  if (count && !dryRun) {
    await Course.updateMany(filter, { $set : { archived : true } });
  }
  return count;
}

async function trashStudentTrinkets(cutoff, now, dryRun) {
  var Snippet = mongoose.model('Snippet'),
      ids     = await studentIds();

  if (!ids.length) return 0;

  var filter = {
    deletedAt : null,
    created   : { $lte : cutoff },
    $or       : [{ _owner : { $in : ids } }, { _creator : { $in : ids } }]
  };
  var count = await Snippet.countDocuments(filter);

  if (count && !dryRun) {
    await Snippet.updateMany(filter, { $set : { deletedAt : now } });
  }
  return count;
}

async function purgeTrash(now, dryRun) {
  var Snippet   = mongoose.model('Snippet'),
      threshold = new Date(now.getTime() - trashDays() * 24 * 60 * 60 * 1000),
      docs      = await Snippet.find({ deletedAt : { $ne : null, $lte : threshold } }).select('_id').lean(),
      ids       = docs.map(function(d) { return d._id; });

  if (ids.length && !dryRun) {
    await mongoose.model('Draft').deleteMany({ trinket : { $in : ids } });
    await mongoose.model('Interaction').deleteMany({ _trinket : { $in : ids } });
    await Snippet.deleteMany({ _id : { $in : ids } });
  }
  return ids.length;
}

/**
 * Kompletter Wartungslauf.
 * @param {{ now?: Date, dryRun?: boolean }} options
 */
async function run(options) {
  options = options || {};
  var now    = options.now || new Date(),
      dryRun = !!options.dryRun;

  if (!isEnabled()) {
    logger().info('[Aufbewahrung] deaktiviert (app.retention.enabled=false)');
    return { enabled : false };
  }

  var cutoff = lastSchoolYearEnd(now),
      result = {
        enabled         : true,
        dryRun          : dryRun,
        now             : now.toISOString(),
        schoolYearEnd   : cutoff.toISOString(),
        trashDays       : trashDays(),
        archivedCourses : await archiveCourses(cutoff, dryRun),
        trashedTrinkets : await trashStudentTrinkets(cutoff, now, dryRun),
        purgedTrinkets  : await purgeTrash(now, dryRun)
      };

  logger().info('[Aufbewahrung] ' + (dryRun ? 'Probelauf' : 'Lauf') + ': Kurse archiviert=' + result.archivedCourses
    + ', Trinkets in Papierkorb=' + result.trashedTrinkets + ', endgültig gelöscht=' + result.purgedTrinkets
    + ' (Schuljahresende ' + cutoff.toISOString().slice(0, 10) + ', Papierkorb ' + result.trashDays + ' Tage)');

  return result;
}

module.exports = {
  isEnabled            : isEnabled,
  trashDays            : trashDays,
  lastSchoolYearEnd    : lastSchoolYearEnd,
  studentIds           : studentIds,
  archiveCourses       : archiveCourses,
  trashStudentTrinkets : trashStudentTrinkets,
  purgeTrash           : purgeTrash,
  run                  : run
};
