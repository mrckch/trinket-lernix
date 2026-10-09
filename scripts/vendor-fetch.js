#!/usr/bin/env node
/**
 * Frontend-Bibliotheken selbst hosten (Trinket Lernix, Std 8 – keine externen CDNs).
 *
 *   node scripts/vendor-fetch.js          lädt alles aus config/vendor.json nach public/vendor/
 *   node scripts/vendor-fetch.js --check  prüft nur, ob alle im Code referenzierten /vendor/-Pfade existieren
 *
 * Läuft beim Image-Bau (Dockerfile). Vorhandene Dateien werden nicht erneut geladen.
 * CSS-Dateien werden nach url(…)-Verweisen durchsucht (Schriften von Font Awesome, Video.js,
 * Weather Icons) und diese ebenfalls geholt.
 */
'use strict';

var fs    = require('fs'),
    path  = require('path'),
    https = require('https'),
    http  = require('http');

var ROOT      = path.join(__dirname, '..'),
    PUBLIC    = path.join(ROOT, 'public'),
    VENDOR    = path.join(PUBLIC, 'vendor'),
    manifest  = require('../config/vendor.json');

var HOSTS = {
  'cdnjs.cloudflare.com' : { strip : '/ajax/libs/', key : 'cdnjs' },
  'ajax.googleapis.com'  : { strip : '/ajax/libs/', key : 'googleapis' },
  'code.jquery.com'      : { strip : '/',           key : 'jquery' }
};

/** https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js → vendor/cdnjs/jquery/2.2.4/jquery.min.js */
function localPathFor(url) {
  var u    = new URL(url),
      host = HOSTS[u.hostname];
  if (!host) throw new Error('Unbekannter Host in vendor.json: ' + url);
  var rel = u.pathname.indexOf(host.strip) === 0 ? u.pathname.substring(host.strip.length) : u.pathname.replace(/^\//, '');
  return path.join('vendor', host.key, rel);
}

function fetch(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    var client = url.indexOf('https:') === 0 ? https : http;
    client.get(url, { headers : { 'User-Agent' : 'trinket-lernix-vendor-fetch' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' für ' + url));
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function download(url, relPath) {
  var target = path.join(PUBLIC, relPath);
  if (fs.existsSync(target)) return { skipped : true, target : target };

  var body = await fetch(url);
  fs.mkdirSync(path.dirname(target), { recursive : true });
  fs.writeFileSync(target, body);
  return { skipped : false, target : target, body : body };
}

/** url(../fonts/x.woff2?v=4.7.0) in CSS → nachladen, Query/Hash entfernen */
async function fetchCssAssets(cssUrl, cssRelPath, cssText) {
  var seen = {}, re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g, m, count = 0;
  while ((m = re.exec(cssText)) !== null) {
    var ref = m[1].trim();
    if (/^(data:|https?:|\/\/|#)/.test(ref)) continue;
    var clean = ref.split('?')[0].split('#')[0];
    if (!clean || seen[clean]) continue;
    seen[clean] = true;
    var assetUrl = new URL(clean, cssUrl).toString(),
        assetRel = path.join(path.dirname(cssRelPath), clean);
    try {
      var r = await download(assetUrl, assetRel);
      if (!r.skipped) count++;
    } catch (err) {
      console.warn('  ! ' + assetUrl + ': ' + err.message);
    }
  }
  return count;
}

async function fetchAll() {
  var loaded = 0, skipped = 0;
  for (var i = 0; i < manifest.urls.length; i++) {
    var url = manifest.urls[i], rel = localPathFor(url);
    try {
      var r = await download(url, rel);
      if (r.skipped) { skipped++; }
      else {
        loaded++;
        console.log('  + ' + rel);
        if (/\.css$/.test(rel)) {
          var extra = await fetchCssAssets(url, rel, r.body.toString('utf8'));
          if (extra) console.log('    (' + extra + ' Schrift-/Bilddateien)');
        }
      }
    } catch (err) {
      console.error('  ! ' + url + ': ' + err.message);
      process.exitCode = 1;
    }
  }

  (manifest.fromNodeModules || []).forEach(function(entry) {
    var from = path.join(ROOT, 'node_modules', entry.package),
        to   = path.join(VENDOR, entry.to);
    if (!fs.existsSync(from)) {
      console.error('  ! node_modules/' + entry.package + ' fehlt (npm install)');
      process.exitCode = 1;
      return;
    }
    if (fs.existsSync(to)) { skipped++; return; }
    fs.cpSync(from, to, { recursive : true });
    loaded++;
    console.log('  + vendor/' + entry.to + ' (aus node_modules/' + entry.package + ')');
  });

  console.log('[vendor] ' + loaded + ' geladen, ' + skipped + ' vorhanden');
}

/** Alle /vendor/…-Verweise in Konfiguration, Templates, Skripten und Stylesheets gegen public/vendor
 *  prüfen und verbliebene CDN-Verweise melden (Std 8: keine externen CDNs). */
var CDN_RE = /\/\/(cdnjs\.cloudflare\.com|ajax\.googleapis\.com|code\.jquery\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)\//g;

function check() {
  var files = [], missing = [], refs = {}, cdn = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes : true }).forEach(function(d) {
      var p = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== 'node_modules' && d.name !== 'vendor' && d.name !== 'components') walk(p); }
      else if (/\.(yaml|html|js|scss|css)$/.test(d.name) && !/\.min\.(js|css)$/.test(d.name)) files.push(p);
    });
  }
  walk(path.join(ROOT, 'config')); walk(path.join(ROOT, 'lib')); walk(path.join(ROOT, 'public')); walk(path.join(ROOT, 'static'));

  files.forEach(function(file) {
    var text = fs.readFileSync(file, 'utf8'), re = /\/vendor\/[A-Za-z0-9_.\-\/]+/g, m;
    while ((m = re.exec(text)) !== null) refs[m[0]] = file;
    text.split('\n').forEach(function(line, i) {
      CDN_RE.lastIndex = 0;
      if (CDN_RE.test(line)) cdn.push(path.relative(ROOT, file) + ':' + (i + 1) + '  ' + line.trim().substring(0, 120));
    });
  });

  Object.keys(refs).forEach(function(ref) {
    if (!fs.existsSync(path.join(PUBLIC, ref))) missing.push(ref + '  (' + path.relative(ROOT, refs[ref]) + ')');
  });

  if (cdn.length) {
    console.error('[vendor] externe CDN-Verweise:\n  ' + cdn.join('\n  '));
    process.exitCode = 1;
  }
  if (missing.length) {
    console.error('[vendor] fehlende Dateien:\n  ' + missing.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('[vendor] alle ' + Object.keys(refs).length + ' Verweise vorhanden');
  }
}

if (require.main === module) {
  if (process.argv.indexOf('--check') >= 0) check();
  else fetchAll().then(check);
}

module.exports = { localPathFor : localPathFor, fetchAll : fetchAll, check : check };
