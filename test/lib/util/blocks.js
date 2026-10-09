// Blockly-XML → Python auf dem Server (ADR 0006). Die erwarteten .py-Dateien in test/data/blocks
// stammen aus dem echten Blockly des Editors (blockly_compressed.js + python_compressed.js, v20180924)
// mit denselben Einstellungen wie im Browser – die Ausgabe muss Zeichen für Zeichen gleich sein.
var should = require('chai').should(),
    fs     = require('fs'),
    path   = require('path'),
    blocks = require('../../../lib/services/blocks'),
    xml    = require('../../../lib/services/blocks/xml');

var DIR = path.join(__dirname, '..', '..', 'data', 'blocks');

function fixture(name) {
  return fs.readFileSync(path.join(DIR, name), 'utf8');
}

var COMPONENTS = path.join(__dirname, '..', '..', '..', 'public', 'components', 'blockly', 'generators', 'python.js');

function rep(text, n) { return new Array(n + 1).join(text); }

/** Umwandlung muss schnell mit Fehlermeldung (oder Ergebnis) enden – nie hängen oder abstürzen. */
function fast(xmlText) {
  var started = Date.now(),
      result  = blocks.convert(xmlText);
  (Date.now() - started).should.be.below(1000);
  return result;
}

describe('Blöcke → Python', function() {
  before(function() {
    if (blocks.isAvailable()) return;
    // Liegt public/components vor, darf die Umwandlung nicht still übersprungen werden
    if (fs.existsSync(COMPONENTS)) throw new Error('Blockly-Generatoren vorhanden, aber nicht ladbar.');
    this.skip();   // nur ohne Komponenten-Tarball (lokal)
  });

  fs.readdirSync(DIR).filter(function(f) { return /\.xml$/.test(f); }).forEach(function(file) {
    it('übersetzt ' + file + ' wie der Editor', function() {
      blocks.toPython(fixture(file)).should.eql(fixture(file.replace(/\.xml$/, '.py')));
    });
  });

  it('Schleifen und Turtle-Bewegungen', function() {
    var code = blocks.toPython(fixture('quadrat.xml'));
    code.should.contain('import turtle');
    code.should.contain('for count in range(4):\n  turtle.forward(100)\n  turtle.right(90)\n');
  });

  it('Funktionen mit Parametern und globalen Variablen', function() {
    var code = blocks.toPython(fixture('vieleck-funktion.xml'));
    code.should.contain('def vieleck(seiten, l_C3_A4nge):\n  global anzahl\n');
    code.should.contain('vieleck(anzahl, 50)');
  });

  it('if/elif/else, Modulo und Zufall', function() {
    var code = blocks.toPython(fixture('gerade-zufall.xml'));
    code.should.contain('if i % 2 == 0:');
    code.should.contain('wurf = random.randint(1, 6)');
    code.should.contain('elif wurf == 1:');
  });

  it('überspringt deaktivierte Blöcke und behält freie Werte', function() {
    var code = blocks.toPython(fixture('rueckgabe-schleife.xml'));
    code.should.not.contain('summe + 1');
    code.should.contain('\n42\n');
  });

  it('meldet unbekannte Blöcke und kaputtes XML verständlich', function() {
    blocks.convert('<xml><block type="gibtsnicht"></block></xml>').pythonError.should.contain('gibtsnicht');
    blocks.convert('<xml><block type="text_print">').pythonError.should.match(/Ungültiges Blockly-XML/);
    blocks.convert('<html></html>').pythonError.should.contain('<xml>');
    should.not.exist(blocks.convert('<xml><block').pythonCode);
    blocks.convert('<xml xmlns="http://www.w3.org/1999/xhtml"></xml>').pythonCode.should.eql('');
  });

  it('begrenzt die Zahl der Blöcke', function() {
    var many = '<xml>' + new Array(3002).join('<block type="math_number"><field name="NUM">1</field></block>') + '</xml>';
    fast(many).pythonError.should.contain('Zu viele Blöcke');
  });

  describe('feindliches XML endet schnell', function() {
    it('riesige Zahlen in Mutationen (Listen, Text, if/elif)', function() {
      fast('<xml><block type="lists_create_with"><mutation items="2000000000"></mutation></block></xml>').pythonCode.split('None').length.should.be.below(30);
      fast('<xml><block type="text_print"><value name="TEXT"><block type="text_join"><mutation items="999999999"></mutation></block></value></block></xml>').pythonCode.length.should.be.below(500);
      fast('<xml><block type="controls_if"><mutation elseif="2000000000" else="7"></mutation></block></xml>').pythonCode.split('elif').length.should.be.below(30);
      var high = '<xml><block type="lists_create_with"><mutation items="2000000000"></mutation><value name="ADD100000"><block type="math_number"><field name="NUM">1</field></block></value></block></xml>';
      fast(high).pythonCode.split('None').length.should.be.below(300);
      fast('<xml><block type="procedures_callnoreturn"><mutation name="f">' + rep('<arg name="a"></arg>', 300) + '</mutation></block></xml>').pythonError.should.contain('Parameter');
    });

    it('leere Plätze am Ende bleiben wie im Editor', function() {
      fast('<xml><block type="lists_create_with"><mutation items="3"></mutation><value name="ADD0"><block type="math_number"><field name="NUM">1</field></block></value></block></xml>')
        .pythonCode.should.eql('[1, None, None]\n');
    });

    it('1 MB Kommentar und viele lange Kommentare', function() {
      var big = '<xml><block type="text_print"><comment>' + rep('wort ', 200000) + '</comment></block></xml>';
      big.length.should.be.below(xml.MAX_LENGTH);
      should.exist(fast(big).pythonCode);
      var many = '<xml>' + rep('<block type="text_print"><comment>' + rep('wort ', 380) + '</comment></block>', 500) + '</xml>';
      should.exist(fast(many).pythonCode);
    });

    it('5000 Variablen', function() {
      var vars = '<xml><variables>' + Array.from({ length : 5000 }, function(_, i) { return '<variable id="v' + i + '">v' + i + '</variable>'; }).join('') + '</variables></xml>';
      fast(vars).pythonError.should.contain('Zu viele Variablen');
    });

    it('__proto__, constructor, init … als Blocktyp oder Feldname', function() {
      ['__proto__', 'constructor', 'init', 'finish', 'workspaceToCode', 'blockToCode', 'scrub_', 'toString', 'hasOwnProperty'].forEach(function(type) {
        fast('<xml><block type="' + type + '"></block></xml>').pythonError.should.contain('Unbekannter Block');
      });
      fast('<xml><block type="text"><field name="__proto__">x</field><field name="constructor">y</field><field name="TEXT">ok</field></block></xml>')
        .pythonCode.should.eql("'ok'\n");
      fast('<xml><variables><variable id="__proto__">__proto__</variable></variables><block type="variables_set"><field name="VAR" id="__proto__">__proto__</field></block></xml>')
        .pythonCode.should.contain('= 0');
    });

    it('tiefe Verschachtelung', function() {
      var deep = '<xml>' + rep('<block type="math_single"><field name="OP">NEG</field><value name="NUM">', 900) + rep('</value></block>', 900) + '</xml>';
      var result = fast(deep);
      (result.pythonCode || result.pythonError).should.be.a('string');
    });
  });
});

describe('Blockly-XML-Parser', function() {
  it('liest Attribute, Text und Entitäten', function() {
    var root = xml.parse('<?xml version="1.0"?><xml a="1"><field name="T">&lt;a&gt; &amp; &#228;&#x00FC;</field><!-- x --><b/></xml>');
    root.name.should.eql('xml');
    root.attrs.a.should.eql('1');
    root.children[0].text.should.eql('<a> & äü');
    root.children[1].name.should.eql('b');
  });

  it('lehnt Unvollständiges, mehrere Wurzeln und DTD-Tricks ab', function() {
    (function() { xml.parse('<xml><a></xml>'); }).should.throw();
    (function() { xml.parse('<a></a><b></b>'); }).should.throw();
    // Entitäten aus einer DTD werden nicht expandiert
    var root = xml.parse('<!DOCTYPE x [<!ENTITY e "boom">]><xml>&e;</xml>');
    root.text.should.eql('&e;');
  });
});
