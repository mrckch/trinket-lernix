'use strict';

/**
 * Echte Client-IP hinter dem Nginx Proxy Manager und IP-Allowlist für den Admin-Bereich
 * (Std 7.4; Muster aus LeFo ADR 0002: die App ist maßgeblich, der NPM nur zusätzlich).
 *
 * X-Forwarded-For wird nur übernommen, wenn die direkte Gegenstelle in TRUSTED_PROXIES steht –
 * sonst könnte jeder per gefälschtem Header die IP-Sperre umgehen.
 */

var ipaddr = require('ipaddr.js'),
    config = require('config');

function parseAddress(value) {
  try {
    return ipaddr.process(String(value || '').trim());   // IPv4-mapped IPv6 → IPv4
  } catch (e) {
    return null;
  }
}

/** "10.0.0.0/24, 192.168.1.20, ::1" → Liste von [Adresse, Präfixlänge]; "*" erlaubt alles. */
function parseList(text) {
  return String(text || '')
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(Boolean)
    .map(function(entry) {
      if (entry === '*') return ['*', 0];
      try {
        if (entry.indexOf('/') >= 0) {
          var cidr = ipaddr.parseCIDR(entry);
          var addr = cidr[0].kind() === 'ipv6' && cidr[0].isIPv4MappedAddress() ? cidr[0].toIPv4Address() : cidr[0];
          return [addr, cidr[1]];
        }
        var single = parseAddress(entry);
        return single ? [single, single.kind() === 'ipv6' ? 128 : 32] : null;
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

function matches(ip, list) {
  var addr = parseAddress(ip);
  if (!addr) return false;

  return list.some(function(range) {
    if (range[0] === '*') return true;
    if (addr.kind() !== range[0].kind()) return false;
    return addr.match(range[0], range[1]);
  });
}

function trustedProxies() {
  return parseList((config.app && config.app.trustedProxies) || '127.0.0.1');
}

function adminAllowlist() {
  return parseList((config.app && config.app.adminIpAllowlist) || '127.0.0.1/32');
}

/** Client-IP der Anfrage (X-Forwarded-For nur von vertrauenswürdigen Proxys). */
function getClientIp(request) {
  var remote = request.info && request.info.remoteAddress,
      xff    = request.headers && request.headers['x-forwarded-for'];

  if (xff && matches(remote, trustedProxies())) {
    var first = parseAddress(String(xff).split(',')[0]);
    if (first) return first.toString();
  }

  var parsed = parseAddress(remote);
  return parsed ? parsed.toString() : String(remote || '');
}

function isAdminIp(request) {
  return matches(getClientIp(request), adminAllowlist());
}

/** Pfade, die nur aus ADMIN_IP_ALLOWLIST erreichbar sind. */
function isAdminPath(path) {
  return path === '/admin' || path.indexOf('/admin/') === 0 || path.indexOf('/api/admin') === 0;
}

module.exports = {
  parseList   : parseList,
  matches     : matches,
  getClientIp : getClientIp,
  isAdminIp   : isAdminIp,
  isAdminPath : isAdminPath
};
