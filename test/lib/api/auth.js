// Anmeldung in Trinket Lernix: Dev-Login, Sperren im IServ-Modus, Admin-IP-Allowlist
var should   = require('chai').should(),
    config   = require('config'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    accounts = require('../../../lib/auth/accounts');

// Rohes Mongoose-Modell (das globale User ist der Wrapper ohne findOne/deleteMany)
function users() {
  return require('mongoose').model('User');
}

module.exports = function() {
  describe('Lernix Auth', function() {

    describe('Dev-Login (AUTH_MODE=dev)', function() {
      before(function() {
        flow.switchUser('devteacher');
      });

      it('zeigt das Formular', function(done) {
        flow.get('/auth/dev').end(flow.setLastResponse(function(err, res) {
          flow.wasOk.should.be.true;
          res.statusCode.should.eql(200);
          done();
        }));
      });

      it('legt eine Lehrkraft an und meldet sie an', function(done) {
        flow.post('/auth/dev')
          .send({ email : 'dev-lehrkraft@schule.test', fullname : 'Dev Lehrkraft', role : 'teacher' })
          .end(flow.setLastResponse(function(err, res) {
            flow.wasOk.should.be.true;
            res.statusCode.should.eql(302);
            flow.lastRedirect.pathname.should.eql('/home');

            users().findOne({ email : 'dev-lehrkraft@schule.test' }).then(function(user) {
              should.exist(user);
              user.source.should.eql('dev');
              user.hasRole('teacher').should.be.true;
              user.hasRole('student').should.be.false;
              user.hasPermission('create-private-course').should.be.true;
              user.hasPermission('create-python-trinket').should.be.true;
              done();
            }).catch(done);
          }));
      });

      it('setzt die Grundrolle bei erneutem Login neu, Admin bleibt', function(done) {
        flow.post('/auth/dev')
          .send({ email : 'dev-lehrkraft@schule.test', fullname : 'Dev Lehrkraft', role : 'admin' })
          .end(flow.setLastResponse(function() {
            users().findOne({ email : 'dev-lehrkraft@schule.test' }).then(function(user) {
              user.hasRole('admin').should.be.true;
              return accounts.applyBaseRole(user, 'student').then(function(u) { return u.save(); });
            }).then(function(user) {
              user.hasRole('admin').should.be.true;
              user.hasRole('student').should.be.true;
              user.hasRole('teacher').should.be.false;
              user.hasPermission('create-private-course').should.be.true; // über admin
              done();
            }).catch(done);
          }));
      });

      it('lehnt eine ungültige Rolle ab', function(done) {
        flow.post('/auth/dev')
          .send({ email : 'x@schule.test', fullname : 'X', role : 'root' })
          .end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(302);
            flow.lastRedirect.pathname.should.eql('/auth/dev');
            done();
          }));
      });

      after(function(done) {
        users().deleteMany({ email : { $in : ['dev-lehrkraft@schule.test', 'x@schule.test'] } }).then(function() { done(); }).catch(done);
      });
    });

    describe('Schüler-Rolle', function() {
      var student;

      before(function(done) {
        flow.switchUser('devstudent');
        flow.post('/auth/dev')
          .send({ email : 'dev-sus@schule.test', fullname : 'Dev SuS', role : 'student' })
          .end(flow.setLastResponse(function() {
            users().findOne({ email : 'dev-sus@schule.test' }).then(function(user) {
              student = user;
              done();
            }).catch(done);
          }));
      });

      it('darf eigene Trinkets, aber keine Kurse anlegen', function() {
        student.hasPermission('create-python-trinket').should.be.true;
        student.hasPermission('create-html-trinket').should.be.true;
        student.hasPermission('create-blocks-trinket').should.be.true;
        student.hasPermission('create-glowscript-trinket').should.be.true;
        student.hasPermission('create-private-course').should.be.false;
        student.hasPermission('create-public-course').should.be.false;
      });

      it('bekommt beim Anlegen eines Kurses 403', function(done) {
        flow.createCourse({ name : 'Verbotener Kurs' }, function(err, res) {
          res.statusCode.should.eql(403);
          done();
        });
      });

      after(function(done) {
        users().deleteMany({ email : 'dev-sus@schule.test' }).then(function() { done(); }).catch(done);
      });
    });

    describe('IServ-Modus (AUTH_MODE=iserv)', function() {
      var previousMode;

      before(function() {
        previousMode = config.app.auth.mode;
        config.app.auth.mode = 'iserv';
        flow.switchUser('');
      });

      after(function() {
        config.app.auth.mode = previousMode;
      });

      it('leitet /signup auf /login um', function(done) {
        flow.get('/signup').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        }));
      });

      it('nimmt keine Registrierung an', function(done) {
        // .de statt .test: Joi 17 .email() lehnt Testdomains ab, dann käme die Validierung vor dem Handler
        flow.register({ email : 'neu@schule-test.de', username : 'neuerkonto' }, function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          users().findOne({ email : 'neu@schule-test.de' }).then(function(user) {
            should.not.exist(user);
            done();
          }).catch(done);
        });
      });

      it('versteckt den Dev-Login', function(done) {
        flow.get('/auth/dev').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(404);
          done();
        }));
      });

      it('lässt normale Konten nicht lokal anmelden', function(done) {
        flow.login({ email : defaults.user.email, password : defaults.user.password }, function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      it('meldet bei nicht konfiguriertem IServ einen Fehler statt zu starten', function(done) {
        flow.get('/auth/iserv').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        }));
      });

      it('weist einen Rücksprung ohne laufende Anmeldung ab', function(done) {
        flow.get('/auth/iserv/callback?code=abc&state=xyz').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        }));
      });
    });

    describe('Notfall-Admin', function() {
      var previousMode, previousAllowlist;

      before(function(done) {
        previousMode      = config.app.auth.mode;
        previousAllowlist = config.app.adminIpAllowlist;
        config.app.auth.breakglass = { email : 'notfall@schule.test', password : 'Notfall-Passwort-1' };
        accounts.ensureBreakglass().then(function() { done(); }).catch(done);
      });

      after(function() {
        config.app.auth.mode       = previousMode;
        config.app.adminIpAllowlist = previousAllowlist;
        config.app.auth.breakglass = { email : '', password : '' };
      });

      it('wird mit Admin-Rolle angelegt', function(done) {
        users().findOne({ email : 'notfall@schule.test' }).then(function(user) {
          should.exist(user);
          user.source.should.eql('breakglass');
          user.hasRole('admin').should.be.true;
          done();
        }).catch(done);
      });

      it('kann sich im IServ-Modus aus einem erlaubten Netz lokal anmelden', function(done) {
        config.app.auth.mode = 'iserv';
        config.app.adminIpAllowlist = '127.0.0.1/32,::1/128';
        flow.switchUser('breakglass');
        flow.login({ email : 'notfall@schule.test', password : 'Notfall-Passwort-1' }, function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/home');
          done();
        });
      });

      it('sperrt ein altes Notfall-Konto, wenn BREAKGLASS_EMAIL geändert wurde', function(done) {
        config.app.auth.mode = 'iserv';
        config.app.adminIpAllowlist = '127.0.0.1/32,::1/128';
        config.app.auth.breakglass = { email : 'neu-notfall@schule.test', password : 'Notfall-Passwort-2' };
        flow.switchUser('breakglass3');
        flow.login({ email : 'notfall@schule.test', password : 'Notfall-Passwort-1' }, function(err, res) {
          config.app.auth.breakglass = { email : 'notfall@schule.test', password : 'Notfall-Passwort-1' };
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      it('wird aus einem fremden Netz abgewiesen', function(done) {
        config.app.auth.mode = 'iserv';
        config.app.adminIpAllowlist = '10.99.0.0/16';
        flow.switchUser('breakglass2');
        flow.login({ email : 'notfall@schule.test', password : 'Notfall-Passwort-1' }, function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      after(function(done) {
        users().deleteMany({ email : 'notfall@schule.test' }).then(function() { done(); }).catch(done);
      });
    });

    describe('Admin-Bereich und IP-Allowlist', function() {
      var previousAllowlist, previousProxies;

      before(function(done) {
        previousAllowlist = config.app.adminIpAllowlist;
        previousProxies   = config.app.trustedProxies;
        // Eigener Admin per Dev-Login (defaults.admin legt später die Admin-Suite selbst an)
        flow.switchUser('devadmin');
        flow.post('/auth/dev')
          .send({ email : 'dev-admin@schule.test', fullname : 'Dev Admin', role : 'admin' })
          .end(flow.setLastResponse(function(err) { done(err); }));
      });

      after(function(done) {
        config.app.adminIpAllowlist = previousAllowlist;
        config.app.trustedProxies   = previousProxies;
        users().deleteMany({ email : 'dev-admin@schule.test' }).then(function() { done(); }).catch(done);
      });

      it('ist aus einem fremden Netz auch für Admins gesperrt', function(done) {
        config.app.adminIpAllowlist = '10.99.0.0/16';
        flow.admin(function(err, res) {
          res.statusCode.should.eql(403);
          done();
        });
      });

      it('übernimmt X-Forwarded-For vom vertrauenswürdigen Proxy', function(done) {
        config.app.adminIpAllowlist = '10.99.0.0/16';
        config.app.trustedProxies   = '127.0.0.1,::1';   // supertest kommt von localhost
        flow.get('/admin/users').set('X-Forwarded-For', '10.99.1.1').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          done();
        }));
      });

      it('ignoriert X-Forwarded-For von nicht vertrauenswürdigen Absendern', function(done) {
        config.app.adminIpAllowlist = '10.99.0.0/16';
        config.app.trustedProxies   = '192.168.1.20';
        flow.get('/admin/users').set('X-Forwarded-For', '10.99.1.1').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(403);
          done();
        }));
      });

      it('ist aus dem erlaubten Netz erreichbar', function(done) {
        config.app.adminIpAllowlist = '127.0.0.1/32,::1/128';
        flow.admin(function(err, res) {
          res.statusCode.should.eql(200);
          done();
        });
      });
    });
  });
};
