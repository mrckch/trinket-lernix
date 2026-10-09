// Wird vom mongo-Image einmalig beim ersten Start ausgeführt (leeres Datenvolume).
// Legt den App-Benutzer in der App-Datenbank an, damit die App ohne authSource
// mit mongodb://user:pass@host:port/datenbank arbeiten kann (config/db.js).
const user = process.env.MONGO_USER;
const pwd = process.env.MONGO_PASSWORD;
const dbName = process.env.MONGO_DB || 'trinket';

if (!user || !pwd) {
  throw new Error('MONGO_USER und MONGO_PASSWORD müssen gesetzt sein (siehe .env.example).');
}

const appDb = db.getSiblingDB(dbName);
appDb.createUser({
  user: user,
  pwd: pwd,
  roles: [{ role: 'readWrite', db: dbName }],
});
print(`[mongo-init] Benutzer "${user}" für Datenbank "${dbName}" angelegt.`);
