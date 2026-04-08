const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function resolveDbPath() {
  const root = path.join(__dirname, "..", "..");
  if (process.env.DB_PATH) return path.resolve(process.cwd(), process.env.DB_PATH);
  return path.join(root, "database", "alphavs.db");
}

function openDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new Database(dbPath);
}

module.exports = { openDb, resolveDbPath };
