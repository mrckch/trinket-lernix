var should    = require('chai').should()
  , config    = require('config')
  , component = require('../../../lib/util/component');

describe('Komponenten-Pfade', function() {
  it('nimmt selbst gehostete Pfade wörtlich (jquery-ui unter /vendor)', function() {
    config.app.components['jquery-ui'].should.match(/^\/vendor\//);
    component('jquery-ui', 'jquery-ui.min.js')
      .should.contain("src='/vendor/cdnjs/jqueryui/1.12.1/jquery-ui.min.js'");
  });

  it('fällt ohne Pfad auf /components zurück', function() {
    component('lodash', 'dist/lodash.min.js').should.contain("src='/components/dist/lodash.min.js'");
  });
});
