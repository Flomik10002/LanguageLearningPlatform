const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.LL_DB_PATH || path.join(__dirname, 'data', 'flomik-labs.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function openDb() {
  ensureDir();
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

function initDb(db) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

module.exports = {
  DB_PATH,
  openDb,
  initDb
};
