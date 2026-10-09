'use strict';

/**
 * Blockly-XML → Python auf dem Server (Trinket Lernix, ADR 0006).
 *
 * Es laufen dieselben Generatoren wie im Browser: der Python-Generator des Blockly-Forks
 * trinketapp/blockly v20180924 aus public/components/blockly (Release-Tarball, siehe Dockerfile)
 * und die eigenen Blöcke aus public/js/embed/blocks/*.js (Turtle, Text, Diagramme). Statt des
 * ganzen Blockly-Kerns (braucht ein DOM) gibt es hier ein schlankes Block-/Workspace-Modell, das
 * genau die Schnittstelle bietet, die die Generatoren benutzen. Die Dateien werden einmal in einen
 * eigenen vm-Kontext geladen; SuS-XML wird nur geparst, nie ausgeführt.
 *
 * Einstellungen wie im Editor (public/js/embed/blocks.js, createPythonTrinket):
 * disableInitVariables_ = true (keine „x = None“-Zeilen), oneBasedIndex = true (Blockly-Default).
 */

var fs   = require('fs'),
    path = require('path'),
    vm   = require('vm'),
    xml  = require('./xml');

var ROOT           = path.join(__dirname, '..', '..', '..'),
    MAX_BLOCKS     = 3000,
    MAX_VARIABLES  = 1000,
    MAX_SLOTS      = 200,      // höchste Zahl von Eingängen/Parametern je Block aus einer Mutation
    MAX_EMPTY      = 20,       // leere Plätze hinter dem letzten belegten Eingang (wie im Editor möglich)
    MAX_COMMENT    = 2000,     // Zeichen je Blockkommentar
    COMMENT_BUDGET = 20000,    // Zeichen aller Blockkommentare zusammen
    WRAP_WORDS     = 200,      // längere Kommentarzeilen werden nicht umbrochen (Aufwand wächst stark)
    MAX_CALLS      = 50000,    // blockToCode-Aufrufe je Umwandlung
    MAX_MILLIS     = 1000,     // Zeitbudget je Umwandlung
    INPUT_VALUE    = 1,
    NEXT_STATEMENT = 3;

var CORE_FILES = [
  'core/names.js',
  'core/generator.js',
  'generators/python.js',
  'generators/python/colour.js',
  'generators/python/lists.js',
  'generators/python/logic.js',
  'generators/python/loops.js',
  'generators/python/math.js',
  'generators/python/procedures.js',
  'generators/python/text.js',
  'generators/python/variables.js'
];

var CUSTOM_FILES = [
  'public/js/embed/blocks/turtle.js',
  'public/js/embed/blocks/more_text.js',
  'public/js/embed/blocks/matplotlib.js'
];

function BlocksError(message) {
  var err = new Error(message);
  err.name = 'BlocksError';
  return err;
}

function blocklyDir() {
  return process.env.TRINKET_BLOCKLY_DIR || path.join(ROOT, 'public', 'components', 'blockly');
}

// --- Hilfsfunktionen aus Blockly-Kern (core/utils.js, core/blockly.js), unverändert übernommen ---

function wrapToText(words, wordBreaks) {
  var text = [];
  for (var i = 0; i < words.length; i++) {
    text.push(words[i]);
    if (wordBreaks[i] !== undefined) text.push(wordBreaks[i] ? '\n' : ' ');
  }
  return text.join('');
}

function wrapScore(words, wordBreaks, limit) {
  var lineLengths = [0], linePunctuation = [], i;
  for (i = 0; i < words.length; i++) {
    lineLengths[lineLengths.length - 1] += words[i].length;
    if (wordBreaks[i] === true) {
      lineLengths.push(0);
      linePunctuation.push(words[i].charAt(words[i].length - 1));
    } else if (wordBreaks[i] === false) {
      lineLengths[lineLengths.length - 1]++;
    }
  }
  var maxLength = Math.max.apply(Math, lineLengths), score = 0;
  for (i = 0; i < lineLengths.length; i++) {
    score -= Math.pow(Math.abs(limit - lineLengths[i]), 1.5) * 2;
    score -= Math.pow(maxLength - lineLengths[i], 1.5);
    if ('.?!'.indexOf(linePunctuation[i]) != -1) {
      score += limit / 3;
    } else if (',;)]}'.indexOf(linePunctuation[i]) != -1) {
      score += limit / 4;
    }
  }
  if (lineLengths.length > 1 && lineLengths[lineLengths.length - 1] <= lineLengths[lineLengths.length - 2]) {
    score += 0.5;
  }
  return score;
}

function wrapMutate(words, wordBreaks, limit) {
  var bestScore = wrapScore(words, wordBreaks, limit), bestBreaks;
  for (var i = 0; i < wordBreaks.length - 1; i++) {
    if (wordBreaks[i] == wordBreaks[i + 1]) continue;
    var mutated = [].concat(wordBreaks);
    mutated[i] = !mutated[i];
    mutated[i + 1] = !mutated[i + 1];
    var mutatedScore = wrapScore(words, mutated, limit);
    if (mutatedScore > bestScore) {
      bestScore  = mutatedScore;
      bestBreaks = mutated;
    }
  }
  return bestBreaks ? wrapMutate(words, bestBreaks, limit) : wordBreaks;
}

function wrapLine(text, limit) {
  if (text.length <= limit) return text;
  var words = text.trim().split(/\s+/), i;
  if (words.length > WRAP_WORDS) return text;
  for (i = 0; i < words.length; i++) {
    if (words[i].length > limit) limit = words[i].length;
  }
  var lastScore, score = -Infinity, lastText, lineCount = 1;
  do {
    lastScore = score;
    lastText  = text;
    var wordBreaks = [], steps = words.length / lineCount, insertedBreaks = 1;
    for (i = 0; i < words.length - 1; i++) {
      if (insertedBreaks < (i + 1.5) / steps) {
        insertedBreaks++;
        wordBreaks[i] = true;
      } else {
        wordBreaks[i] = false;
      }
    }
    wordBreaks = wrapMutate(words, wordBreaks, limit);
    score = wrapScore(words, wordBreaks, limit);
    text  = wrapToText(words, wordBreaks);
    lineCount++;
  } while (score > lastScore);
  return lastText;
}

function wrap(text, limit) {
  return String(text).split('\n').map(function(line) { return wrapLine(line, limit); }).join('\n');
}

// --- Workspace-/Block-Modell mit der Schnittstelle, die die Generatoren brauchen ---

function VariableModel(name, id) {
  this.name = name;
  this.type = '';
  this.id_  = id;
}
VariableModel.prototype.getId = function() { return this.id_; };

function Workspace(blockTypes) {
  this.topBlocks_     = [];
  this.variables_     = [];
  this.varById_       = new Map();
  this.varByName_     = new Map();
  this.blockTypes_    = blockTypes;
  this.blockCount_    = 0;
  this.commentBudget_ = COMMENT_BUDGET;
  this.RTL            = false;
  this.options        = { oneBasedIndex : true };
}

Workspace.prototype.getVariable = function(name) {
  return this.varByName_.get(String(name).toLowerCase()) || null;
};

Workspace.prototype.getVariableById = function(id) {
  return this.varById_.get(id) || null;
};

Workspace.prototype.variableFor = function(name, id) {
  name = String(name || '');
  var found = (id && this.getVariableById(id)) || this.getVariable(name);
  if (found) return found;
  if (this.variables_.length >= MAX_VARIABLES) throw BlocksError('Zu viele Variablen (höchstens ' + MAX_VARIABLES + ').');
  var created = new VariableModel(name, id || ('var:' + name));
  this.variables_.push(created);
  this.varById_.set(created.id_, created);
  if (!this.varByName_.has(name.toLowerCase())) this.varByName_.set(name.toLowerCase(), created);
  return created;
};

/** Kommentartext begrenzen (je Block und insgesamt), damit das Umbrechen billig bleibt. */
Workspace.prototype.takeComment = function(text) {
  var allowed = Math.max(0, Math.min(MAX_COMMENT, this.commentBudget_));
  text = String(text || '').substring(0, allowed);
  this.commentBudget_ -= text.length;
  return text;
};

Workspace.prototype.getVariableMap = function() {
  var self = this;
  return { getVariableById : function(id) { return self.getVariableById(id); } };
};

Workspace.prototype.getTopBlocks = function(ordered) {
  var blocks = [].concat(this.topBlocks_);
  if (ordered && blocks.length > 1) {
    var offset = Math.sin(3 * Math.PI / 180);   // Blockly.Workspace.SCAN_ANGLE
    blocks.sort(function(a, b) {
      var aXY = a.getRelativeToSurfaceXY(), bXY = b.getRelativeToSurfaceXY();
      return (aXY.y + offset * aXY.x) - (bXY.y + offset * bXY.x);
    });
  }
  return blocks;
};

Workspace.prototype.getAllBlocks = function() {
  var blocks = this.getTopBlocks(false);
  for (var i = 0; i < blocks.length; i++) {
    blocks.push.apply(blocks, blocks[i].getChildren(false));
  }
  return blocks;
};

function Block(workspace, type, id) {
  var self = this;
  this.workspace        = workspace;
  this.type             = type;
  this.id               = id;
  this.disabled         = false;
  this.comment          = '';
  this.fields_          = Object.create(null);
  this.inputs_          = Object.create(null);
  this.inputList        = [];
  this.childBlocks_     = [];
  this.next_            = null;
  this.xy_              = { x : 0, y : 0 };
  this.outputConnection = null;
  this.nextConnection   = { targetBlock : function() { return self.next_; } };
  this.arguments_       = [];
  this.argumentVarModels_ = [];
}

Block.prototype.getFieldValue = function(name) {
  var field = this.fields_[name];
  if (!field) return null;
  return field.variable ? field.variable.getId() : field.value;
};
Block.prototype.getField = function(name) { return this.fields_[name] || null; };
Block.prototype.getInputTargetBlock = function(name) {
  var input = this.inputs_[name];
  return input ? input.connection.targetBlock() : null;
};
Block.prototype.getInput = function(name) {
  if (this.type === 'controls_if') {
    // Platzhalter nur bis zur (begrenzten) Zahl aus der Mutation
    var m = /^(IF|DO)(\d+)$/.exec(name);
    if (m) return parseInt(m[2], 10) <= this.elseifCount_ ? (this.inputs_[name] || { name : name }) : null;
    if (name === 'ELSE') return this.elseCount_ ? (this.inputs_[name] || { name : name }) : null;
  }
  return this.inputs_[name] || null;
};
Block.prototype.getNextBlock   = function() { return this.next_; };
Block.prototype.getCommentText = function() { return this.comment || ''; };
Block.prototype.getChildren    = function() { return this.childBlocks_; };
Block.prototype.getRelativeToSurfaceXY = function() { return this.xy_; };
Block.prototype.getDescendants = function() {
  var out = [this];
  this.childBlocks_.forEach(function(child) { out.push.apply(out, child.getDescendants()); });
  return out;
};
Block.prototype.getVarModels = function() {
  var vars = [];
  for (var name in this.fields_) {
    if (this.fields_[name].variable) vars.push(this.fields_[name].variable);
  }
  return vars.concat(this.argumentVarModels_);
};

function intAttr(attrs, name, fallback) {
  var value = parseInt(attrs[name], 10);
  return isNaN(value) || value < 0 ? fallback : value;
}

/** Höchster belegter Index n eines Eingangs PREFIXn im XML (-1, wenn keiner). */
function highestIndex(present, prefix) {
  var max = -1;
  present.forEach(function(name) {
    if (name.indexOf(prefix) === 0 && /^\d+$/.test(name.substring(prefix.length))) {
      max = Math.max(max, parseInt(name.substring(prefix.length), 10));
    }
  });
  return max;
}

/**
 * Zahl aus einer Mutation begrenzen: höchstens bis kurz hinter den letzten belegten Eingang
 * (leere Plätze am Ende gibt es auch im Editor) und nie über MAX_SLOTS.
 */
function slots(value, present, prefix) {
  return Math.min(value, MAX_SLOTS, highestIndex(present, prefix) + 1 + MAX_EMPTY);
}

function applyMutation(block, mutation, present) {
  var attrs = mutation ? mutation.attrs : {},
      args  = mutation ? xml.childrenNamed(mutation, 'arg') : [];

  if (args.length > MAX_SLOTS) throw BlocksError('Zu viele Parameter an einem Block (höchstens ' + MAX_SLOTS + ').');

  switch (block.type) {
    case 'controls_if':
      block.elseifCount_ = slots(intAttr(attrs, 'elseif', 0), present, 'IF');
      block.elseCount_   = intAttr(attrs, 'else', 0) ? 1 : 0;
      break;
    case 'lists_create_with':
      block.itemCount_ = slots(intAttr(attrs, 'items', 3), present, 'ADD');
      break;
    case 'text_join':
      block.itemCount_ = slots(intAttr(attrs, 'items', 2), present, 'ADD');
      break;
    case 'procedures_defnoreturn':
    case 'procedures_defreturn':
      block.getProcedureDef = function() { return [this.getFieldValue('NAME'), this.arguments_, this.type === 'procedures_defreturn']; };
      block.arguments_ = args.map(function(a) { return a.attrs.name || ''; });
      block.argumentVarModels_ = args.map(function(a) { return block.workspace.variableFor(a.attrs.name || '', a.attrs.varid); });
      break;
    case 'procedures_callnoreturn':
    case 'procedures_callreturn':
      block.arguments_ = args.map(function(a) { return a.attrs.name || ''; });
      if (attrs.name !== undefined) block.fields_.NAME = { value : attrs.name };
      break;
    case 'procedures_ifreturn':
      block.hasReturnValue_ = mutation ? attrs.value == 1 : true;
      break;
  }
}

function targetOf(el) {
  return xml.childrenNamed(el, 'block')[0] || xml.childrenNamed(el, 'shadow')[0] || null;
}

function domToBlock(el, workspace) {
  if (++workspace.blockCount_ > MAX_BLOCKS) throw BlocksError('Zu viele Blöcke (höchstens ' + MAX_BLOCKS + ').');

  var type = el.attrs.type;
  if (!type) throw BlocksError('Block ohne Typ.');
  if (!workspace.blockTypes_.has(type)) throw BlocksError('Unbekannter Block „' + type + '“.');

  var block   = new Block(workspace, type, el.attrs.id || ('b' + workspace.blockCount_)),
      present = el.children.filter(function(c) { return c.name === 'value' || c.name === 'statement'; })
                  .map(function(c) { return c.attrs.name || ''; });
  block.disabled = el.attrs.disabled === 'true';

  applyMutation(block, xml.childrenNamed(el, 'mutation')[0] || null, present);

  el.children.forEach(function(child) {
    var name = child.attrs.name;
    switch (child.name) {
      case 'field':
        if (name === 'VAR' || child.attrs.variabletype !== undefined) {
          block.fields_[name] = { value : child.text, variable : workspace.variableFor(child.text, child.attrs.id) };
        } else if (!(name === 'NAME' && block.fields_.NAME && /^procedures_call/.test(type))) {
          block.fields_[name] = { value : child.text };
        }
        break;
      case 'comment':
        block.comment = workspace.takeComment(child.text);
        break;
      case 'value':
      case 'statement':
        var targetEl = targetOf(child),
            target   = targetEl ? domToBlock(targetEl, workspace) : null,
            kind     = child.name === 'value' ? INPUT_VALUE : NEXT_STATEMENT;
        if (target) {
          if (kind === INPUT_VALUE) target.outputConnection = { targetConnection : {} };
          block.childBlocks_.push(target);
        }
        var input = { name : name, type : kind, connection : { targetBlock : function() { return target; } } };
        block.inputs_[name] = input;
        block.inputList.push(input);
        break;
      case 'next':
        var nextEl = targetOf(child);
        if (nextEl) {
          block.next_ = domToBlock(nextEl, workspace);
          block.childBlocks_.push(block.next_);
        }
        break;
    }
  });

  return block;
}

function workspaceFromXml(text, blockTypes) {
  var root;
  try {
    root = xml.parse(text);
  } catch (err) {
    throw BlocksError('Ungültiges Blockly-XML: ' + err.message);
  }
  if (root.name !== 'xml') throw BlocksError('Ungültiges Blockly-XML: Wurzelelement <xml> fehlt.');

  var workspace = new Workspace(blockTypes || loadRuntime().blockTypes);
  root.children.forEach(function(child) {
    if (child.name === 'variables') {
      xml.childrenNamed(child, 'variable').forEach(function(v) { workspace.variableFor(v.text, v.attrs.id); });
    }
    else if (child.name === 'block' || child.name === 'shadow') {
      var block = domToBlock(child, workspace);
      block.xy_ = { x : parseFloat(child.attrs.x) || 0, y : parseFloat(child.attrs.y) || 0 };
      workspace.topBlocks_.push(block);
    }
  });
  return workspace;
}

// --- Laufzeit mit den Original-Generatoren ---

var runtime = null;

function provide(ns, name) {
  var parts = name.split('.'), obj = ns;
  for (var i = 0; i < parts.length; i++) {
    if (obj[parts[i]] === undefined) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
}

function loadRuntime() {
  if (runtime) return runtime;

  var dir = blocklyDir();
  if (!fs.existsSync(path.join(dir, 'generators', 'python.js'))) {
    throw BlocksError('Blockly-Generatoren nicht gefunden (' + dir + '); public/components fehlt.');
  }

  var Blockly = {
    Blocks         : {},
    Msg            : {},
    INPUT_VALUE    : INPUT_VALUE,
    NEXT_STATEMENT : NEXT_STATEMENT,
    ALIGN_RIGHT    : 1,
    Variables      : {
      NAME_TYPE : 'VARIABLE',
      allUsedVarModels : function(workspace) {
        var hash = Object.create(null), list = [];
        workspace.getAllBlocks().forEach(function(block) {
          block.getVarModels().forEach(function(v) { if (v.getId()) hash[v.getId()] = v; });
        });
        for (var id in hash) list.push(hash[id]);
        return list;
      },
      allDeveloperVariables : function() { return []; }
    },
    Procedures     : { NAME_TYPE : 'PROCEDURE' },
    utils          : { wrap : wrap },
    isNumber       : function(str) { return /^\s*-?\d+(\.\d+)?\s*$/.test(str); }
  };

  var sandbox = {
    Blockly : Blockly,
    goog    : {
      provide : function(name) { provide(sandbox, name); },
      require : function() {}
    },
    console : { log : function() {}, warn : function() {}, error : function() {} }
  };
  var context = vm.createContext(sandbox);

  var helpers = null;
  CORE_FILES.forEach(function(file) {
    var full = path.join(dir, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename : full });
    // alles, was generators/python.js selbst anlegt (init, finish, quote_ …), ist kein Blocktyp
    if (file === 'generators/python.js') helpers = new Set(Object.keys(sandbox.Blockly.Python));
  });
  CUSTOM_FILES.forEach(function(file) {
    var full = path.join(ROOT, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename : full });
  });

  var Python = sandbox.Blockly.Python;
  Python.disableInitVariables_ = true;
  Python.mapBlocks_ = false;

  // Nur echte Block-Generatoren als Typ zulassen (nicht __proto__, constructor, init …)
  var blockTypes = new Set(Object.keys(Python).filter(function(key) {
    return !helpers.has(key) && typeof Python[key] === 'function' && /^[a-z][a-zA-Z0-9_]*$/.test(key);
  }));

  // Arbeitsbudget je Umwandlung (ohne Worker-Threads): Aufrufe und Zeit zählen
  var budget = { calls : 0, started : 0 },
      blockToCode = Python.blockToCode;
  Python.blockToCode = function(block) {
    if (++budget.calls > MAX_CALLS || (budget.calls % 500 === 0 && Date.now() - budget.started > MAX_MILLIS)) {
      throw BlocksError('Das Programm ist zu groß für die Umwandlung.');
    }
    return blockToCode.call(this, block);
  };

  runtime = { Blockly : sandbox.Blockly, blockTypes : blockTypes, budget : budget };
  return runtime;
}

/** Freistehende Wertblöcke erkennen (ihr Generator liefert [Code, Rang]). */
function markNakedValues(Python, workspace) {
  Python.init(workspace);
  workspace.topBlocks_.forEach(function(block) {
    if (block.outputConnection || typeof Python[block.type] !== 'function') return;
    try {
      if (Array.isArray(Python[block.type].call(block, block))) {
        block.outputConnection = { targetConnection : null };
      }
    } catch (e) { /* wird beim eigentlichen Lauf gemeldet */ }
  });
}

/** Blockly-XML → Python-Code; wirft BlocksError mit deutscher Meldung. */
function toPython(text) {
  var rt        = loadRuntime(),
      Python    = rt.Blockly.Python,
      workspace = workspaceFromXml(String(text || '<xml></xml>'), rt.blockTypes);

  rt.budget.calls   = 0;
  rt.budget.started = Date.now();
  try {
    markNakedValues(Python, workspace);
    return Python.workspaceToCode(workspace);
  } catch (err) {
    if (err && err.name === 'BlocksError') throw err;
    var message = String(err && err.message || err);
    var unknown = /does not know how to generate\s+code for block type "([^"]+)"/.exec(message);
    if (unknown) throw BlocksError('Unbekannter Block „' + unknown[1] + '“.');
    // RangeError kann aus dem vm-Kontext kommen (andere Realm) → Name/Text prüfen statt instanceof
    if ((err && err.name === 'RangeError') || /call stack/i.test(message)) throw BlocksError('Das Programm ist zu tief verschachtelt.');
    throw BlocksError('Die Blöcke konnten nicht in Python umgewandelt werden: ' + message);
  }
}

/** Wie toPython, aber ohne Ausnahme: { pythonCode, pythonError }. */
function convert(text) {
  try {
    return { pythonCode : toPython(text), pythonError : null };
  } catch (err) {
    return { pythonCode : null, pythonError : err.name === 'BlocksError' ? err.message : 'Umwandlung fehlgeschlagen.' };
  }
}

function isAvailable() {
  try {
    loadRuntime();
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  toPython         : toPython,
  convert          : convert,
  isAvailable      : isAvailable,
  workspaceFromXml : workspaceFromXml,
  BlocksError      : BlocksError
};
