#!/usr/bin/env node
/**
 * Anonyme Auswertung der Kursaufgaben (ADR 0008), nur für Admins auf der VM.
 *
 *   docker compose exec app node scripts/auswertung.js                       aktuelles Schuljahr
 *   docker compose exec app node scripts/auswertung.js --schuljahr 2026/27   bestimmtes Schuljahr
 *
 * Gibt Markdown aus (eine Tabelle je Sprache, eine Zeile je Aufgabe). Speichert nichts.
 */
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

var USAGE = 'Verwendung: node scripts/auswertung.js [--schuljahr 2026/27]';

var args = process.argv.slice(2),
    year;

if (args.length) {
  if (args.length !== 2 || args[0] !== '--schuljahr') {
    console.error(USAGE);
    process.exit(2);
  }
  year = args[1];
}

// stdout is reserved for the Markdown report, log messages go to stderr
function toStderr() { console.error.apply(console, arguments); }
global.log = { error : toStderr, warn : toStderr, info : toStderr, verbose : toStderr, debug : function() {} };

var mongoose   = require('mongoose'),
    auswertung = require('../lib/services/auswertung');

try {
  auswertung.schoolYearBounds(year || auswertung.currentSchoolYear(new Date()));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

require('../config/db');
require('../lib/models/user');
require('../lib/models/course');
require('../lib/models/lesson');
require('../lib/models/material');
require('../lib/models/trinket');
require('../lib/models/interaction');

function whenConnected() {
  return new Promise(function(resolve, reject) {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
  });
}

whenConnected()
  .then(function() { return auswertung.run({ schoolYear : year }); })
  .then(function(evaluation) {
    process.stdout.write(auswertung.report(evaluation));
    return mongoose.disconnect();
  })
  .then(function() { process.exit(0); })
  .catch(function(err) {
    console.error('[Auswertung] Fehler:', err.stack || err);
    process.exit(1);
  });
