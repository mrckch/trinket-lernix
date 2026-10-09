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

describe('Blöcke → Python', function() {
  before(function() {
    if (!blocks.isAvailable()) this.skip();   // ohne public/components (nur im Image vorhanden)
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
    blocks.convert(many).pythonError.should.contain('Zu viele Blöcke');
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
