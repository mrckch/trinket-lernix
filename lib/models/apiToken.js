// API-Token (Trinket Lernix, Phase 3): Bearer-Zugang für externe Programme.
// Gespeichert wird nur der SHA-256-Hash des Geheimnisses; das Geheimnis selbst sieht die
// Lehrkraft genau einmal beim Anlegen. Rechte = Token-Scopes ∩ Rechte der Rolle (lib/auth/bearer.js).
var model    = require('./model'),
    mongoose = require('mongoose'),
    ObjectId = mongoose.SchemaTypes.ObjectId,
    schema   = {
      _owner     : { type: ObjectId, ref: 'User', index: true, required: true },
      name       : { type: String, required: true },
      prefix     : { type: String },                        // Anfang des Tokens zur Wiedererkennung
      hash       : { type: String, required: true, unique: true },
      scopes     : [{ type: String }],
      lastUsedAt : { type: Date },
      revokedAt  : { type: Date, default: null }
    };

function findActiveByHash(hash) {
  return this.model.findOne({ hash : hash, revokedAt : null }).exec();
}

function findForUser(userId) {
  return this.model.find({ _owner : userId }).sort({ created : -1 }).exec();
}

module.exports = model.create('ApiToken', {
  schema       : schema,
  classMethods : {
    findActiveByHash : findActiveByHash,
    findForUser      : findForUser
  },
  publicSpec : {
    id : true, name : true, prefix : true, scopes : true, lastUsedAt : true, revokedAt : true, created : true
  }
}).publicModel;
