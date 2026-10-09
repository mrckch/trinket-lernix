var db       = require('../../helpers/db'),
    sequence = [
    'registration',
    'files',
    'login',
    'auth',
    'groups',
    'apiv1',
    'apiv1-write',
    'access',
    'admin',
    'course',
    'profile',
    'logout',
    'forgot_pass',
    'trinket'
  ];

describe('API tests', function() {
  before(db.reset);

  beforeEach(db.ensureConnection);

  sequence.forEach(function(file) {
    var suite = require('./' + file);
    suite();
  });

  after(function(done) {
    db.reset(done);
  });
});
