'use strict';

/**
 * Trinkets für die Token-API (ADR 0006): Code-Format wie der Editor, Bibliothek der Lehrkraft.
 *
 * Gespeichert wird `code` genau so, wie es die Oberfläche tut: Editor-Sprachen (Python, HTML,
 * GlowScript …) als JSON-Liste `[{ name, content, hidden? }]` (public/js/plugins/code-editor.js),
 * Blöcke als Blockly-XML-Text (public/js/embed/blocks.js).
 */

var mongoose = require('mongoose'),
    Boom     = require('@hapi/boom'),
    constants = require('../../config/constants'),
    features = require('../util/features'),
    blocks   = require('./blocks'),
    xml      = require('./blocks/xml');

var MAIN_FILES = {
  'python'     : 'main.py',
  'python3'    : 'main.py',
  'pygame'     : 'main.py',
  'glowscript' : 'main.py',
  'html'       : 'index.html',
  'java'       : 'Main.java',
  'R'          : 'main.R',
  'console'    : 'main.py',
  'music'      : 'main.py'
};

var BLOCKLY_LANGS = ['blocks', 'glowscript-blocks'],
    CACHE_SIZE    = 500;

// Ergebnisse der Umwandlung Blöcke → Python je Trinket-Stand (id + lastUpdated), LRU
var pythonCache = new Map();

function Raw(name) { return mongoose.model(name); }
function TrinketModel() { return global.Trinket || require('../models/trinket'); }

function isId(id) {
  return /^[0-9a-fA-F]{24}$/.test(String(id || ''));
}

function isBlockly(lang) {
  return BLOCKLY_LANGS.indexOf(lang) >= 0;
}

/** Darf die Person Trinkets dieser Sprache anlegen? (Feature-Flag + Rollenrecht wie in der Oberfläche) */
function assertLang(user, lang) {
  if (constants.trinketLangs.indexOf(lang) < 0 || !features.isTrinketTypeEnabled(lang)) {
    throw Boom.badRequest('Die Sprache „' + lang + '“ ist hier nicht verfügbar.');
  }
  if (!user.hasPermission('create-' + lang + '-trinket')) {
    throw Boom.forbidden('Deine Rolle darf keine ' + lang + '-Trinkets anlegen.');
  }
}

/** { code } oder { files } aus der API → gespeicherter code-Text */
function storedCode(lang, input) {
  input = input || {};
  if (isBlockly(lang)) {
    if (input.files) throw Boom.badRequest('Block-Trinkets haben keine Dateien, nur Blockly-XML in „code“.');
    var text = input.code || '';
    if (text) {
      try {
        if (xml.parse(text).name !== 'xml') throw new Error('Wurzelelement <xml> fehlt');
      } catch (err) {
        throw Boom.badRequest('Ungültiges Blockly-XML: ' + err.message);
      }
    }
    return text;
  }

  var files = input.files || [{ name : MAIN_FILES[lang] || 'main.py', content : input.code || '' }],
      names = new Set();
  files.forEach(function(f) {
    if (names.has(f.name)) throw Boom.badRequest('Dateiname doppelt: ' + f.name);
    names.add(f.name);
  });
  return JSON.stringify(files.map(function(f) {
    var out = { name : f.name, content : f.content || '' };
    if (typeof f.hidden === 'boolean') out.hidden = f.hidden;
    return out;
  }));
}

/** Dateien eines Trinkets wie beim Download (lib/controllers/trinket.js downloadJSON) */
function filesOf(trinket) {
  var code = trinket.code || '';
  if (!isBlockly(trinket.lang)) {
    try {
      var parsed = JSON.parse(code);
      if (Array.isArray(parsed)) {
        return parsed.map(function(f) {
          var out = { name : f.name, content : f.content || '' };
          if (f.hidden) out.hidden = true;
          return out;
        });
      }
    } catch (e) { /* einfacher Text = Hauptdatei */ }
  }
  return [{ name : isBlockly(trinket.lang) ? 'main.xml' : (MAIN_FILES[trinket.lang] || 'main.txt'), content : code }];
}

/** Zusatzfelder für Block-Trinkets: Python-Code wie im Editor (nur lang=blocks, ADR 0006). */
function pythonOf(trinket) {
  if (trinket.lang === 'glowscript-blocks') return { pythonCode : null, pythonError : 'Für GlowScript-Blöcke gibt es keine serverseitige Umwandlung.' };
  if (trinket.lang !== 'blocks') return null;

  var stamp = trinket.lastUpdated ? new Date(trinket.lastUpdated).getTime() : 0,
      key   = String(trinket._id || trinket.id) + ':' + stamp + ':' + (trinket.code || '').length,
      hit   = pythonCache.get(key);
  if (hit) {
    pythonCache.delete(key);
    pythonCache.set(key, hit);
    return hit;
  }

  var result = blocks.convert(trinket.code || '');
  pythonCache.set(key, result);
  if (pythonCache.size > CACHE_SIZE) pythonCache.delete(pythonCache.keys().next().value);
  return result;
}

function librarySummary(t) {
  return {
    id          : t.id,
    shortCode   : t.shortCode,
    name        : t.name || '',
    description : t.description || '',
    lang        : t.lang,
    created     : t.created,
    lastUpdated : t.lastUpdated
  };
}

function ownsTrinket(user, trinket) {
  return !!trinket._owner && String(trinket._owner._id || trinket._owner) === String(user._id);
}

async function loadTrinket(id) {
  var doc = null;
  if (isId(id)) {
    doc = await Raw('Snippet').findById(id);
  } else if (/^[A-Za-z0-9]{6,24}$/.test(String(id || ''))) {
    doc = await Raw('Snippet').findOne({ shortCode : id });
  }
  if (!doc || doc.deletedAt) throw Boom.notFound('Trinket nicht gefunden.');
  return doc;
}

async function loadOwnTrinket(user, id) {
  var doc = await loadTrinket(id);
  if (!ownsTrinket(user, doc)) throw Boom.forbidden('Dieses Trinket gehört nicht zu deiner Bibliothek.');
  return doc;
}

async function listLibrary(user, lang) {
  var query = { _owner : user._id, deletedAt : null };
  if (lang) query.lang = lang;
  var docs = await Raw('Snippet').find(query).sort({ lastUpdated : -1 }).limit(500);
  return docs.map(librarySummary);
}

/** Neues Trinket in der Bibliothek der Person (wie POST /api/trinkets?library=true). */
async function createLibraryTrinket(user, data) {
  assertLang(user, data.lang);
  var Trinket = TrinketModel(),
      doc     = new Trinket({
        lang        : data.lang,
        name        : data.name || '',
        description : data.description || '',
        code        : storedCode(data.lang, data),
        _owner      : user._id,
        _creator    : user._id
      });
  await doc.save();
  return doc;
}

/** Aufgaben, die dieses Trinket als Vorlage nutzen und noch in einer Lektion hängen (keine Waisen). */
async function materialsUsing(trinketId, exceptMaterialId) {
  var query = { 'trinket.trinketId' : trinketId };
  if (exceptMaterialId) query._id = { $ne : exceptMaterialId };
  var candidates = await Raw('Material').find(query).select('_id name');
  if (!candidates.length) return [];
  var lessons = await Raw('Lesson').find({ materials : { $in : candidates.map(function(m) { return m._id; }) } }).select('materials');
  return candidates.filter(function(m) {
    return lessons.some(function(l) { return l.materials.some(function(id) { return String(id) === String(m._id); }); });
  });
}

/** Vorlage einer Aufgabe vorab prüfen (vor dem ersten Schreiben, z. B. beim Reihen-Import). */
async function checkStarter(user, starter) {
  starter = starter || { lang : 'python' };
  if (starter.trinketId) return loadOwnTrinket(user, starter.trinketId);
  if (starter.lang) {
    assertLang(user, starter.lang);
    storedCode(starter.lang, starter);
  }
  return null;
}

function touchFolder(trinket) {
  if (!trinket.folder || !trinket.folder.folderId || !global.Folder) return;
  global.Folder.findById(trinket.folder.folderId)
    .then(function(folder) {
      if (folder) return folder.updateTrinket({ id : trinket.id, name : trinket.name, instructions : trinket.description });
    })
    .catch(function() {});
}

async function updateLibraryTrinket(user, trinket, patch) {
  if (!ownsTrinket(user, trinket)) throw Boom.forbidden('Dieses Trinket gehört nicht zu deiner Bibliothek.');
  if (patch.name !== undefined) trinket.name = patch.name;
  if (patch.description !== undefined) trinket.description = patch.description;
  if (patch.code !== undefined || patch.files !== undefined) trinket.code = storedCode(trinket.lang, patch);
  await trinket.save();
  touchFolder(trinket);
  return trinket;
}

async function deleteLibraryTrinket(user, trinket) {
  if (!ownsTrinket(user, trinket)) throw Boom.forbidden('Dieses Trinket gehört nicht zu deiner Bibliothek.');

  var usedBy = await materialsUsing(trinket._id);
  if (usedBy.length) {
    throw Boom.conflict('Das Trinket ist die Vorlage der Aufgabe „' + usedBy[0].name + '“ und kann nicht gelöscht werden.');
  }

  if (trinket.folder && trinket.folder.folderId && global.Folder) {
    var folder = await global.Folder.findById(trinket.folder.folderId);
    if (folder) await folder.removeTrinket(trinket.id);
  }
  await trinket.softDelete();
  return trinket;
}

module.exports = {
  MAIN_FILES           : MAIN_FILES,
  isId                 : isId,
  isBlockly            : isBlockly,
  assertLang           : assertLang,
  storedCode           : storedCode,
  filesOf              : filesOf,
  pythonOf             : pythonOf,
  materialsUsing       : materialsUsing,
  checkStarter         : checkStarter,
  librarySummary       : librarySummary,
  ownsTrinket          : ownsTrinket,
  loadTrinket          : loadTrinket,
  loadOwnTrinket       : loadOwnTrinket,
  listLibrary          : listLibrary,
  createLibraryTrinket : createLibraryTrinket,
  updateLibraryTrinket : updateLibraryTrinket,
  deleteLibraryTrinket : deleteLibraryTrinket
};
