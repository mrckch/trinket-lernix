'use strict';

/**
 * Kleiner, nicht rekursiver XML-Parser für Blockly-XML (Trinket Lernix, ADR 0006).
 *
 * Blockly schreibt wohlgeformtes XML ohne DTD; mehr als Elemente, Attribute, Text, Kommentare
 * und CDATA braucht es nicht. Bewusst ohne Abhängigkeit und ohne Entitäten-Expansion außer den
 * fünf vordefinierten und numerischen Zeichenreferenzen (kein XXE, keine „Billion Laughs“).
 */

var MAX_LENGTH = 1024 * 1024,
    MAX_DEPTH  = 2000,
    MAX_NODES  = 50000;

var TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
var ATTR  = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function XmlError(message) {
  var err = new Error(message);
  err.name = 'XmlError';
  return err;
}

function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, function(all, ent) {
    switch (ent) {
      case 'lt'   : return '<';
      case 'gt'   : return '>';
      case 'amp'  : return '&';
      case 'quot' : return '"';
      case 'apos' : return '\'';
    }
    var code = ent[1] === 'x' ? parseInt(ent.substring(2), 16) : parseInt(ent.substring(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch (e) {
      return '';
    }
  });
}

function element(name, attrText) {
  var attrs = {}, m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(attrText || ''))) {
    attrs[m[1]] = decode(m[2] !== undefined ? m[2] : m[3]);
  }
  return { name : name, attrs : attrs, children : [], text : '' };
}

/** XML-Text → Wurzelelement { name, attrs, children, text } oder XmlError. */
function parse(text) {
  if (typeof text !== 'string') throw XmlError('Kein XML-Text.');
  if (text.length > MAX_LENGTH) throw XmlError('XML ist zu groß.');

  var root  = element('#document'),
      stack = [root],
      nodes = 0,
      m;

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    var top = stack[stack.length - 1];

    if (m[7]) {
      throw XmlError('Ungültiges XML an Position ' + m.index + '.');
    }
    else if (m[1] !== undefined) {                          // CDATA
      top.text += m[1];
    }
    else if (m[2]) {                                        // schließendes Tag
      if (stack.length < 2 || top.name !== m[2]) {
        throw XmlError('Unerwartetes </' + m[2] + '>.');
      }
      stack.pop();
    }
    else if (m[3]) {                                        // öffnendes Tag
      if (++nodes > MAX_NODES) throw XmlError('XML hat zu viele Elemente.');
      var el = element(m[3], m[4]);
      top.children.push(el);
      if (!m[5]) {
        stack.push(el);
        if (stack.length > MAX_DEPTH) throw XmlError('XML ist zu tief verschachtelt.');
      }
    }
    else if (m[6] !== undefined) {                          // Text
      top.text += decode(m[6]);
    }
  }

  if (stack.length !== 1) throw XmlError('XML ist unvollständig (<' + stack[stack.length - 1].name + '> nicht geschlossen).');

  var elements = root.children;
  if (elements.length !== 1) throw XmlError('XML braucht genau ein Wurzelelement.');
  return elements[0];
}

function childrenNamed(el, name) {
  return el.children.filter(function(c) { return c.name === name; });
}

module.exports = {
  parse         : parse,
  childrenNamed : childrenNamed,
  MAX_LENGTH    : MAX_LENGTH
};
