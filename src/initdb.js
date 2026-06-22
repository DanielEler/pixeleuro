// Legt das Datenbankschema an. Aufruf: npm run initdb
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

try {
  await pool.query(schema);
  console.log('✅ Datenbankschema erfolgreich angelegt.');
} catch (err) {
  console.error('❌ Fehler beim Anlegen des Schemas:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
