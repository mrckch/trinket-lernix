#!/usr/bin/env node
/**
 * Täglicher Wartungslauf (Aufbewahrung, ADR 0003).
 *
 *   node scripts/maintenance.js            Lauf
 *   node scripts/maintenance.js --dry-run  nur zählen, nichts ändern
 *
 * Im Betrieb startet der Compose-Dienst "maintenance" dieses Skript einmal täglich.
 */
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

global.log = require('../config/log');

var mongoose = require('mongoose');

require('../config/db');
require('../lib/models/user');
require('../lib/models/course');
require('../lib/models/trinket');
require('../lib/models/draft');
require('../lib/models/interaction');

var retention = require('../lib/util/retention'),
    dryRun    = process.argv.indexOf('--dry-run') >= 0;

function whenConnected() {
  return new Promise(function(resolve, reject) {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
  });
}

whenConnected()
  .then(function() { return retention.run({ dryRun : dryRun }); })
  .then(function(result) {
    console.log(JSON.stringify(result));
    return mongoose.disconnect();
  })
  .then(function() { process.exit(0); })
  .catch(function(err) {
    console.error('[Aufbewahrung] Fehler:', err.stack || err);
    process.exit(1);
  });
