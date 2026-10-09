// Historischer Platzhalter: Sessions liegen seit Hapi 20 in MongoDB (lib/util/catbox-mongoose.js),
// Redis ist in config/test.yaml abgeschaltet (In-Memory-Fallback). Das alte catbox-redis-Paket
// ist nicht mehr installiert, deshalb hier kein Mock mehr.
module.exports = {};
