// Claim-Auswertung der IServ-Anbindung (reine Funktionen, kein Netz)
var should = require('chai').should(),
    iserv  = require('../../../lib/auth/iserv'),
    clientIp = require('../../../lib/util/clientIp');

describe('IServ-Claims', function() {
  var markers = ['lehrer', 'teacher', 'kollegium'];

  it('findet Claims unter allen Schreibweisen', function() {
    iserv.claim({ 'iserv:uuid' : 'abc' }, 'uuid').should.eql('abc');
    iserv.claim({ iserv_groups : ['x'] }, 'groups').should.eql(['x']);
    should.not.exist(iserv.claim({}, 'roles'));
  });

  it('bevorzugt die IServ-UUID vor sub', function() {
    iserv.subjectOf({ sub : '42', 'iserv:uuid' : 'uuid-1' }).should.eql('uuid-1');
    iserv.subjectOf({ sub : 42 }).should.eql('42');
    should.not.exist(iserv.subjectOf({}));
  });

  it('erkennt Lehrkräfte über Rollen', function() {
    iserv.looksLikeTeacher({ roles : ['ROLE_TEACHER'] }, markers).should.be.true;
    iserv.looksLikeTeacher({ 'iserv:roles' : [{ name : 'Lehrer/in' }] }, markers).should.be.true;
  });

  it('erkennt Lehrkräfte über Gruppen', function() {
    iserv.looksLikeTeacher({ groups : [{ act : 'kollegium', name : 'Kollegium' }] }, markers).should.be.true;
    iserv.looksLikeTeacher({ groups : { 'lehrer.mathe' : 'Lehrer Mathe' } }, markers).should.be.true;
  });

  it('macht alle anderen zu Schülerinnen und Schülern', function() {
    iserv.looksLikeTeacher({ roles : ['ROLE_STUDENT'], groups : [{ act : 'klasse.9b', name : 'Klasse 9b' }] }, markers).should.be.false;
    iserv.looksLikeTeacher({}, markers).should.be.false;
    iserv.looksLikeTeacher({ roles : ['ROLE_TEACHER'] }, []).should.be.false;
  });

  it('liefert Gruppen als act/name ohne interne Felder', function() {
    var entries = iserv.groupEntries({ groups : [
      { id : 'ffffffffffffffffffffff', act : 'klasse.9b', name : 'Klasse 9b' },
      { id : 'eeeeeeeeeeeeeeeeeeeeee', act : 'ag.robotik', name : 'AG Robotik' },
      { act : 'klasse.9b', name : 'Klasse 9b' },
      'informatik.wp'
    ]});
    entries.should.eql([
      { act : 'ag.robotik', name : 'AG Robotik' },
      { act : 'informatik.wp', name : 'informatik.wp' },
      { act : 'klasse.9b', name : 'Klasse 9b' }
    ]);
  });

  it('liefert Gruppen auch aus Mappings', function() {
    iserv.groupEntries({ 'iserv:groups' : { 'klasse.7a' : 'Klasse 7a' } }).should.eql([{ act : 'klasse.7a', name : 'Klasse 7a' }]);
    iserv.groupEntries({}).should.eql([]);
  });

  it('bildet Anzeigename, E-Mail und Account', function() {
    var claims = { given_name : 'Erika', family_name : 'Muster', email : 'Erika.Muster@RSSTU.de', preferred_username : 'Erika.Muster' };
    iserv.displayNameOf(claims).should.eql('Erika Muster');
    iserv.emailOf(claims).should.eql('erika.muster@rsstu.de');
    iserv.accountOf(claims).should.eql('erika.muster');
    iserv.displayNameOf({ name : 'Max' }).should.eql('Max');
    iserv.accountOf({ email : 'max@rsstu.de' }).should.eql('max');
  });

  it('protokolliert nur Claim-Namen', function() {
    iserv.claimKeys({ email : 'x', sub : 'y' }).should.eql('email, sub');
    iserv.claimKeys({}).should.eql('(keine)');
  });

  it('bildet die Redirect-URI aus der öffentlichen Adresse', function() {
    iserv.redirectUri().should.match(/\/auth\/iserv\/callback$/);
  });
});

describe('Client-IP und Allowlist', function() {
  it('prüft Adressen gegen CIDR-Listen', function() {
    var list = clientIp.parseList('192.168.1.0/24, 10.0.0.5, ::1');
    clientIp.matches('192.168.1.77', list).should.be.true;
    clientIp.matches('::ffff:192.168.1.77', list).should.be.true;
    clientIp.matches('10.0.0.5', list).should.be.true;
    clientIp.matches('10.0.0.6', list).should.be.false;
    clientIp.matches('::1', list).should.be.true;
    clientIp.matches('kaputt', list).should.be.false;
  });

  it('erlaubt alles mit 0.0.0.0/0 und ::/0', function() {
    var list = clientIp.parseList('0.0.0.0/0,::/0');
    clientIp.matches('203.0.113.9', list).should.be.true;
    clientIp.matches('2001:db8::1', list).should.be.true;
  });

  it('übernimmt X-Forwarded-For nur von vertrauenswürdigen Proxys', function() {
    var config = require('config');
    var previous = config.app.trustedProxies;
    config.app.trustedProxies = '192.168.1.20';

    clientIp.getClientIp({ info : { remoteAddress : '192.168.1.20' }, headers : { 'x-forwarded-for' : '203.0.113.9, 192.168.1.20' } })
      .should.eql('203.0.113.9');
    clientIp.getClientIp({ info : { remoteAddress : '192.168.1.99' }, headers : { 'x-forwarded-for' : '203.0.113.9' } })
      .should.eql('192.168.1.99');
    clientIp.getClientIp({ info : { remoteAddress : '::ffff:10.1.1.1' }, headers : {} })
      .should.eql('10.1.1.1');

    config.app.trustedProxies = previous;
  });

  it('kennt die Admin-Pfade', function() {
    clientIp.isAdminPath('/admin').should.be.true;
    clientIp.isAdminPath('/admin/users').should.be.true;
    clientIp.isAdminPath('/api/admin/user/1').should.be.true;
    clientIp.isAdminPath('/administration').should.be.false;
    clientIp.isAdminPath('/home').should.be.false;
  });
});
