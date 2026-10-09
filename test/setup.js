process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

var chai           = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    sinonChai      = require('sinon-chai');

chai.should();
chai.use(chaiAsPromised);
chai.use(sinonChai);

// Redis ist in config/test.yaml abgeschaltet (In-Memory-Fallback), daher kein redis-mock mehr.
// Wichtig: app.js lädt Hapi/Joi vor mongoose-schema-extend – diese Datei wird deshalb per
// `--require` in test/mocha.opts als Erstes geladen (siehe Kommentar in config/app.config.js).
var config = require('config');

var app = require('../app.js'),
    db  = require('./helpers/db');

// app.js setzt die globalen Modelle erst in seiner asynchronen Initialisierung; die
// Modell-Tests greifen aber schon beim Laden darauf zu. Daher hier synchron setzen
// (dieselben, gecachten Module – app.js weist sie später nur erneut zu).
global.User             = require('../lib/models/user');
global.Course           = require('../lib/models/course');
global.Lesson           = require('../lib/models/lesson');
global.Material         = require('../lib/models/material');
global.File             = require('../lib/models/file');
global.Trinket          = require('../lib/models/trinket');
global.Interaction      = require('../lib/models/interaction');
global.Folder           = require('../lib/models/folder');
global.CourseInvitation = require('../lib/models/courseInvitation');
global.ApiToken         = require('../lib/models/apiToken');

module.exports = {};
