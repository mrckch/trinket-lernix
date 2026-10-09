
Blockly.Blocks['pyplot_plot'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('zeichne Diagramm mit x:');
    this.appendValueInput('X');
    this.appendValueInput('Y')
      .appendField('y:');
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['pyplot_plot'] = function(block) {
  Blockly.Python.definitions_['import_matplotlib_pyplot'] = 'import matplotlib.pyplot';
  var x = Blockly.Python.valueToCode(block, 'X', Blockly.Python.ORDER_NONE) || '0';
  var y = Blockly.Python.valueToCode(block, 'Y', Blockly.Python.ORDER_NONE) || '0';
  return 'matplotlib.pyplot.plot(' + x + ',' + y + ')\n';
}

Blockly.Blocks['pyplot_show'] = {
  init : function() {
    this.setColour(160);
    this.appendDummyInput()
      .appendField('zeige Diagramm');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['pyplot_show'] = function(block) {
  Blockly.Python.definitions_['import_matplotlib_pyplot'] = 'import matplotlib.pyplot';
  return 'matplotlib.pyplot.show()\n';
};

Blockly.Blocks['pyplot_title'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('STRING').appendField('Titel');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['pyplot_title'] = function(block) {
  Blockly.Python.definitions_['import_matplotlib_pyplot'] = 'import matplotlib.pyplot';
  var value = Blockly.Python.valueToCode(block, 'STRING', Blockly.Python.ORDER_NONE) || '';
  return 'matplotlib.pyplot.title(' + value + ')\n';
};

Blockly.Blocks['pyplot_xlabel'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('STRING').appendField('Beschriftung x-Achse');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['pyplot_xlabel'] = function(block) {
  Blockly.Python.definitions_['import_matplotlib_pyplot'] = 'import matplotlib.pyplot';
  var value = Blockly.Python.valueToCode(block, 'STRING', Blockly.Python.ORDER_NONE) || '';
  return 'matplotlib.pyplot.xlabel(' + value + ')\n';
};

Blockly.Blocks['pyplot_ylabel'] = {
  init : function() {
    this.setColour(160);
    this.appendValueInput('STRING').appendField('Beschriftung y-Achse');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
  }
};

Blockly.Python['pyplot_ylabel'] = function(block) {
  Blockly.Python.definitions_['import_matplotlib_pyplot'] = 'import matplotlib.pyplot';
  var value = Blockly.Python.valueToCode(block, 'STRING', Blockly.Python.ORDER_NONE) || '';
  return 'matplotlib.pyplot.ylabel(' + value + ')\n';
};

Blockly.Blocks['numpy_linspace'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('START')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.linspace')
      .appendField('Start');

    this.appendValueInput('STOP')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('Ende');

    this.appendValueInput('VALUE')
      .setCheck('Number')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('Anzahl');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_linspace'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var start = Blockly.Python.valueToCode(block, 'START', Blockly.Python.ORDER_NONE) || '0';
  var stop = Blockly.Python.valueToCode(block, 'STOP', Blockly.Python.ORDER_NONE) || '0';
  var num = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '50';
  return ['numpy.linspace(' + start + ',' + stop + ',' + num + ')', Blockly.Python.ORDER_NONE];
}

Blockly.Blocks['numpy_array'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('VALUE')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.array');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_array'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var argument0 = Blockly.Python.valueToCode(block, 'VALUE',
      Blockly.Python.ORDER_NONE) || '[]';
  return ['numpy.array(' + argument0 + ')', Blockly.Python.ORDER_FUNCTION_CALL];
};

Blockly.Blocks['numpy_sin'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('VALUE')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.sin');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_sin'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var argument0 = Blockly.Python.valueToCode(block, 'VALUE',
      Blockly.Python.ORDER_NONE) || '[]';
  return ['numpy.sin(' + argument0 + ')', Blockly.Python.ORDER_FUNCTION_CALL];
};

Blockly.Blocks['numpy_cos'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('VALUE')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.cos');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_cos'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var argument0 = Blockly.Python.valueToCode(block, 'VALUE',
      Blockly.Python.ORDER_NONE) || '[]';
  return ['numpy.cos(' + argument0 + ')', Blockly.Python.ORDER_FUNCTION_CALL];
};

Blockly.Blocks['numpy_tan'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('VALUE')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.tan');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_tan'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var argument0 = Blockly.Python.valueToCode(block, 'VALUE',
      Blockly.Python.ORDER_NONE) || '[]';
  return ['numpy.tan(' + argument0 + ')', Blockly.Python.ORDER_FUNCTION_CALL];
};

Blockly.Blocks['numpy_exp'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('VALUE')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.exp');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_exp'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var argument0 = Blockly.Python.valueToCode(block, 'VALUE',
      Blockly.Python.ORDER_NONE) || '[]';
  return ['numpy.exp(' + argument0 + ')', Blockly.Python.ORDER_FUNCTION_CALL];
};

Blockly.Blocks['numpy_arange'] = {
  init : function() {
    this.setColour(160);

    this.appendValueInput('START')
      .setCheck('Number')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('numpy.arange')
      .appendField('Start');

    this.appendValueInput('STOP')
      .setCheck('Number')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('Ende');

    this.appendValueInput('STEP')
      .setCheck('Number')
      .setAlign(Blockly.ALIGN_RIGHT)
      .appendField('Schrittweite');

    this.setOutput(true);
  }
};

Blockly.Python['numpy_arange'] = function(block) {
  Blockly.Python.definitions_['import_numpy'] = 'import numpy';
  var start = Blockly.Python.valueToCode(block, 'START', Blockly.Python.ORDER_NONE) || '0';
  var stop = Blockly.Python.valueToCode(block, 'STOP', Blockly.Python.ORDER_NONE) || '0';
  var step = Blockly.Python.valueToCode(block, 'STEP', Blockly.Python.ORDER_NONE) || '1';
  return ['numpy.arange(' + start + ',' + stop + ',' + step + ')', Blockly.Python.ORDER_NONE];
}
