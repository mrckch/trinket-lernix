// Eigene Lernix-Blöcke (TurtleCoder-Reihe): Blickrichtung und Stiftdicke
var should = require('chai').should(),
    blocks = require('../../../lib/services/blocks');

function xml(inner) {
  return '<xml xmlns="http://www.w3.org/1999/xhtml">' + inner + '</xml>';
}

describe('Lernix-Blöcke: Blickrichtung und Stiftdicke', function() {
  before(function() {
    if (!blocks.isAvailable()) this.skip();   // ohne public/components (nur im Image vorhanden)
  });

  it('„schaue nach oben“ wird zu turtle.setheading(90)', function() {
    var code = blocks.toPython(xml('<block type="draw_heading" x="10" y="10"><field name="DIR">90</field><next><block type="draw_move"><field name="DIR">forward</field><value name="VALUE"><shadow type="math_number"><field name="NUM">50</field></shadow></value></block></next></block>'));
    code.should.contain('import turtle');
    code.should.contain('turtle.setheading(90)\nturtle.forward(50)\n');
  });

  it('unbekannte Richtungen fallen auf oben zurück', function() {
    blocks.toPython(xml('<block type="draw_heading"><field name="DIR">45; import os</field></block>')).should.contain('turtle.setheading(90)');
  });

  it('„setze Stiftdicke auf“ wird zu turtle.pensize(…)', function() {
    blocks.toPython(xml('<block type="draw_pensize"><value name="VALUE"><shadow type="math_number"><field name="NUM">5</field></shadow></value></block>')).should.contain('turtle.pensize(5)');
  });
});
