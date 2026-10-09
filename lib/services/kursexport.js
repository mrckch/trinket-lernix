'use strict';

/**
 * Kurs-Export (Lernix): alle Abgaben eines Kurses als ZIP – zum Sichern vor dem Schuljahresende
 * (ADR 0003) und für Leistungsnachweise. Inhalt:
 *   LIESMICH.txt                      Aufbau und Stand
 *   lernstand.csv                     SuS × Aufgabe (Semikolon, UTF-8 mit BOM für Excel)
 *   <Name (Benutzername)>/<NN Lektion – Aufgabe>/
 *       Dateien der maßgeblichen Abgabe (wie im Dashboard), bei Blöcken zusätzlich programm.py
 *       info.txt                      Status, Daten, Kommentar der SuS, Rückmeldung
 */

var JSZip     = require('jszip'),
    mongoose  = require('mongoose'),
    lernstand = require('./lernstand');

var STATUS = {
  'not-started' : 'nicht begonnen',
  started       : 'begonnen',
  submitted     : 'abgegeben',
  completed     : 'zurückgegeben'
};

/** Datei- und Ordnernamen für Windows, macOS und iPad unbedenklich machen. */
function safeName(text, fallback) {
  var name = String(text || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
  return name || fallback;
}

function datum(d) {
  if (!d) return '';
  var t = new Date(d);
  if (isNaN(t)) return '';
  var p = function(n) { return (n < 10 ? '0' : '') + n; };
  return p(t.getDate()) + '.' + p(t.getMonth() + 1) + '.' + t.getFullYear() + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
}

function csvCell(value) {
  var s = String(value === undefined || value === null ? '' : value);
  // Formel-Injection in Tabellenprogrammen verhindern
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function statusText(entry) {
  if (!entry) return STATUS['not-started'];
  return STATUS[entry.state] + (entry.late ? ' (verspätet)' : '');
}

function infoText(student, assignment, entry) {
  var t = entry.trinket, fb = t.feedback || {}, lines = [
    'Aufgabe:      ' + assignment.name,
    'Lektion:      ' + (assignment.lessonName || ''),
    'Schüler:in:   ' + (student.name || '') + ' (' + (student.username || '') + ')',
    'Status:       ' + STATUS[entry.state] + (t.late ? ' (verspätet)' : ''),
    'Versuche:     ' + entry.attempts,
    'Begonnen:     ' + datum(t.startedOn),
    'Abgegeben:    ' + datum(t.submittedOn),
    'Zuletzt:      ' + datum(t.lastUpdated),
    'Sprache:      ' + t.lang,
    ''
  ];
  lines.push('Kommentar der Schülerin / des Schülers:', fb.studentComment ? fb.studentComment : '–', '');
  lines.push('Rückmeldung' + (fb.author ? ' von ' + fb.author : '') + (fb.at ? ' (' + datum(fb.at) + ')' : '') + ':',
             fb.text ? fb.text : '–', '');
  if (t.pythonError) lines.push('Hinweis: Die Blöcke ließen sich nicht in Python umwandeln: ' + t.pythonError, '');
  return lines.join('\r\n');
}

/** Dateien einer Abgabe in den Ordner legen; bei Blöcken XML + Python. */
function addTrinketFiles(folder, trinket) {
  var files = (trinket.files || []).filter(function(f) { return f && f.name; });
  if (trinket.lang === 'blocks') {
    folder.file('bloecke.xml', trinket.code || '');
    if (trinket.pythonCode) folder.file('programm.py', trinket.pythonCode);
    return;
  }
  if (!files.length) {
    folder.file(trinket.lang === 'html' ? 'index.html' : 'main.py', trinket.code || '');
    return;
  }
  files.forEach(function(f) {
    var parts = String(f.name).split('/').map(function(p, i) { return safeName(p, 'datei' + i); });
    folder.file(parts.join('/'), f.content || '');
  });
}

/**
 * ZIP-Datei (Buffer) und Dateiname für einen Kurs. Rechte prüft der Aufrufer
 * (lernstand.assertCourseAccess).
 */
async function exportCourse(course) {
  var stand  = await lernstand.lernstand(course),
      zip    = new JSZip(),
      matrix = {};

  // je Aufgabe die maßgeblichen Trinkets aller SuS (wie Dashboard/API), mit Code
  var perAssignment = [];
  for (var i = 0; i < stand.assignments.length; i++) {
    var a = stand.assignments[i];
    var material = await mongoose.model('Material').findById(a.id);
    var subs = material ? await lernstand.assignmentSubmissions(course, material, { includeCode : true }) : { submissions : [] };
    perAssignment.push({ assignment : a, index : i + 1, submissions : subs.submissions });
    subs.submissions.forEach(function(s) {
      matrix[s.student.id + '|' + a.id] = s.trinket ? { state : s.state, late : s.trinket.late } : null;
    });
  }

  // lernstand.csv
  var header = ['Name', 'Benutzername'].concat(stand.assignments.map(function(a) { return a.name; }));
  var rows = stand.students.map(function(s) {
    return [s.name, s.username].concat(stand.assignments.map(function(a) { return statusText(matrix[s.id + '|' + a.id]); }));
  });
  zip.file('lernstand.csv', '﻿' + [header].concat(rows).map(function(r) { return r.map(csvCell).join(';'); }).join('\r\n') + '\r\n');

  // Ordner je SuS
  var used = {};
  var folderOf = function(s) {
    if (used[s.id]) return used[s.id];
    var name = safeName((s.name || s.username) + ' (' + s.username + ')', 'Schueler-' + s.id);
    return (used[s.id] = zip.folder(name));
  };
  var count = 0;
  perAssignment.forEach(function(p) {
    var nr = (p.index < 10 ? '0' : '') + p.index;
    p.submissions.forEach(function(s) {
      if (!s.trinket) return;
      var folder = folderOf(s.student).folder(safeName(nr + ' ' + p.assignment.name, 'Aufgabe ' + nr));
      addTrinketFiles(folder, s.trinket);
      folder.file('info.txt', infoText(s.student, p.assignment, s));
      count++;
    });
  });

  zip.file('LIESMICH.txt', [
    'Trinket Lernix – Export der Abgaben',
    'Kurs:     ' + course.name,
    'Erstellt: ' + datum(stand.generatedAt),
    'Schülerinnen und Schüler: ' + stand.students.length + ', Aufgaben: ' + stand.assignments.length + ', Arbeiten: ' + count,
    '',
    'lernstand.csv  – Übersicht (öffnet sich in Excel/LibreOffice/Numbers)',
    'Je Schüler:in ein Ordner, darin je Aufgabe die maßgebliche Fassung (abgegeben vor zurückgegeben',
    'vor angefangen) mit info.txt (Status, Kommentar, Rückmeldung). Block-Programme liegen als',
    'bloecke.xml und zusätzlich als programm.py vor.',
    ''
  ].join('\r\n'));

  var buffer = await zip.generateAsync({ type : 'nodebuffer', compression : 'DEFLATE' });
  var stamp  = new Date().toISOString().slice(0, 10);
  return { buffer : buffer, filename : 'abgaben-' + safeName(course.slug, 'kurs') + '-' + stamp + '.zip', count : count };
}

module.exports = {
  exportCourse : exportCourse,
  safeName     : safeName,
  csvCell      : csvCell
};
