
Blockly.Blocks['draw_move'] = {
  init : function() {
    var DIRECTIONS =
      [['gehe vorwärts um', 'forward'],
       ['gehe rückwärts um', 'backward']];
    this.setColour(160);
    this.appendValueInput('VALUE')
      .setCheck('Number')
      .appendField(new Blockly.FieldDropdown(DIRECTIONS), 'DIR');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    // this.setTooltip(BlocklyApps.getMsg('Turtle_moveTooltip'));
  }
};

Blockly.Python['draw_move'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '0';
  return 'turtle.' + block.getFieldValue('DIR') + '(' + value + ')\n';
};

Blockly.Blocks['draw_turn'] = {
  // Block for turning left or right.
  init: function() {
    var DIRECTIONS =
      [['drehe nach rechts um', 'right'],
       ['drehe nach links um', 'left']];
    // Append arrows to direction messages.
    DIRECTIONS[0][0] += ' \u21BB';
    DIRECTIONS[1][0] += ' \u21BA';
    this.setColour(160);
    this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField(new Blockly.FieldDropdown(DIRECTIONS), 'DIR');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    // this.setTooltip(BlocklyApps.getMsg('Turtle_turnTooltip'));
  }
};

Blockly.Python['draw_turn'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '0';
  return 'turtle.' + block.getFieldValue('DIR') + '(' + value + ')\n';
};

Blockly.Blocks['draw_shape'] = {
  // Block for choosing the turtle shape
  init: function() {
    // circle, classic, square, triangle, turtle
    var SHAPES =
      [['Form: Schildkröte', 'turtle'],
       ['Form: Kreis', 'circle'],
       ['Form: Pfeil', 'classic'],
       ['Form: Quadrat', 'square'],
       ['Form: Dreieck', 'triangle']];
    this.setColour(160);
    this.appendDummyInput()
      .appendField(new Blockly.FieldDropdown(SHAPES), 'SHAPE');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_shape'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return 'turtle.shape("' + block.getFieldValue('SHAPE') + '")\n';
};

Blockly.Blocks['draw_pen'] = {
  // Block for choosing the turtle shape
  init: function() {
    var STATE =
      [['Stift anheben', 'penup'],
       ['Stift absetzen', 'pendown']];
    this.setColour(160);
    this.appendDummyInput()
      .appendField(new Blockly.FieldDropdown(STATE), 'PEN');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_pen'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return 'turtle.' + block.getFieldValue('PEN') + '()\n';
};

Blockly.Blocks['draw_color'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('COLOR')
      .appendField('setze Farbe auf');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_color'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'COLOR', Blockly.Python.ORDER_NONE) || '#FFFFFF';
  return 'turtle.color(' + value + ')\n';
};

Blockly.Blocks['draw_write'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('STRING')
      .appendField('schreibe');
    var sizeInput = new Blockly.FieldTextInput('14',
      Blockly.FieldTextInput.nonnegativeIntegerValidator);
    this.appendDummyInput()
      .appendField('Schriftgröße')
      .appendField(sizeInput, 'FONTSIZE');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_write'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'STRING', Blockly.Python.ORDER_NONE) || '';
  var fontsize = block.getFieldValue('FONTSIZE');
  return 'turtle.write(' + value + ', None, None, "' + fontsize + 'pt normal")\n';
};

Blockly.Blocks['draw_circle'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('VALUE')
      .appendField('zeichne Kreis mit Radius');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_circle'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '50';
  return 'turtle.circle(' + value + ')\n';
};

Blockly.Blocks['draw_stamp'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('stemple Abdruck');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_stamp'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return 'turtle.stamp()\n';
};

Blockly.Blocks['begin_fill'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('starte Ausfüllen');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['begin_fill'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return 'turtle.begin_fill()\n';
};

Blockly.Blocks['end_fill'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('beende Ausfüllen');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['end_fill'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return 'turtle.end_fill()\n';
};

Blockly.Blocks['goto'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('gehe zu x:');
    this.appendValueInput('X');
    this.appendValueInput('Y')
      .appendField('y:');
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['goto'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var x = Blockly.Python.valueToCode(block, 'X', Blockly.Python.ORDER_NONE) || '0';
  var y = Blockly.Python.valueToCode(block, 'Y', Blockly.Python.ORDER_NONE) || '0';
  return 'turtle.goto(' + x + ',' + y + ')\n';
};

Blockly.Blocks['draw_speed'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('VALUE')
      .appendField('setze Tempo auf');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_speed'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '50';
  return 'turtle.speed(' + value + ')\n';
};

Blockly.Blocks['draw_pos'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('Position');
    this.setOutput(true);
  }
};

Blockly.Python['draw_pos'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  return ['turtle.pos()', Blockly.Python.ORDER_ATOMIC];
};

// Lernix: Blickrichtung setzen – TurtleCoder startet nach oben, die Python-Turtle nach rechts
Blockly.Blocks['draw_heading'] = {
  init : function() {
    var RICHTUNGEN =
      [['oben ↑', '90'],
       ['rechts →', '0'],
       ['unten ↓', '270'],
       ['links ←', '180']];
    this.setColour(160);
    this.appendDummyInput()
      .appendField('schaue nach')
      .appendField(new Blockly.FieldDropdown(RICHTUNGEN), 'DIR');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_heading'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var dir = parseInt(block.getFieldValue('DIR'), 10);
  if ([0, 90, 180, 270].indexOf(dir) < 0) dir = 90;
  return 'turtle.setheading(' + dir + ')\n';
};

// Lernix: Stiftdicke (TurtleCoder: setPenSize 1–9)
Blockly.Blocks['draw_pensize'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('VALUE')
      .setCheck('Number')
      .appendField('setze Stiftdicke auf');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['draw_pensize'] = function(block) {
  Blockly.Python.definitions_['import_turtle'] = 'import turtle';
  var value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '1';
  return 'turtle.pensize(' + value + ')\n';
};
