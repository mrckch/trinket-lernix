var sinon         = require('sinon'),
    should        = require('chai').should(),
    flow          = require('../../helpers/flow'),
    testStore     = require('../../helpers/store'),
    mail          = require('../../helpers/mail'),
    defaults      = require('../../helpers/defaults');

module.exports = function() {
  // Trinket Lernix: Mail ist aus (ADR 0002), Passwort-Reset entfällt mit dem IServ-Login.
  describe.skip('Forgot Password', function() {
    describe('When entering an invalid email address', function() {
      before(function(done) {
        flow.switchUser('');
        done();
      });

      it('should redirect to forgot password page', function(done) {
        flow.sendPassReset({ email : "doesnot@exist.com" }, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/forgot-pass');
          done();
        });
      });
    });

    describe('When entering a valid email address', function() {
      testStore.stub();
      mail.stub();

      var user;

      before(function(done) {
        flow.switchUser('');
        User.findByLogin(defaults.user.email, function(err, doc) {
          user = doc;
          done();
        });
      });

      it('should send a password reset email', async function() {
        await new Promise(function(resolve) {
          flow.sendPassReset({ email : defaults.user.email }, resolve);
        });

        flow.wasOk.should.be.true;

        testStore.Store.set.firstCall.args[0].should.match(/^user/);
        testStore.Store.set.firstCall.args[0].should.match(/reset$/);

        var val = await testStore.Store.get(testStore.Store.set.firstCall.args[0]);
        val.should.eql(user.id);

        mail.mailer.send.calledOnce.should.be.true;
      });

      describe('When accessing valid reset pasword URL', function() {
        var resetKey;
        before(function(done) {
          flow.switchUser('');
          done();
        });

        it('should allow the reset password page to load', function(done) {
          flow.sendPassReset({ email : defaults.user.email }, function() {
            var keyparts = testStore.Store.set.firstCall.args[0].split(':');
            resetKey = keyparts[1];
            flow.resetPassForm(resetKey, function() {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(200);

              done();
            });
          });
        });

        describe('When entering matching passwords with key', function() {
          it('should change your password', function(done) {
            var pass = 'such course';
            flow.savePass({ key: resetKey, password: pass, password_verify: pass }, function() {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(200);

              // login with new password
              flow.login({ email: defaults.user.email, password: pass }, function() {
                flow.wasOk.should.be.true;
                flow.lastRedirect.pathname.should.eql('/home');

                done();
              });
            });
          });
        });

        describe('When entering passwords without a key', function() {
          it('should redirect to the forgot password page', function(done) {
            flow.savePass({ password: 'such course', password_verify: 'such course' }, function() {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(302);
              flow.lastRedirect.pathname.should.eql('/forgot-pass');

              done();
            });
          });
        });

        describe('When entering non-matching passwords', function() {
          it('should not change your password', function(done) {
            flow.savePass({ key: resetKey, password: 'such course', password_verify: 'much open' }, function() {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(302);
              flow.lastRedirect.pathname.should.eql('/reset-pass');

              done();
            });
          });
        });
      });

      describe('When accessing invalid reset password URL', function() {
        before(function(done) {
          flow.switchUser('');
          done();
        });

        it('should redirect to the forgot password page', function(done) {
          flow.sendPassReset({ email : defaults.user.email }, function() {
            // fake an invalid key (keys are expected to be 8 characters)
            flow.resetPassForm('fake', function() {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(302);
              flow.lastRedirect.pathname.should.eql('/forgot-pass');

              done();
            });
          });
        });
      });
    });
  });
};
