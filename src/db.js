// Zentrale PostgreSQL-Verbindung (Connection Pool).
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Auf Hetzner mit eigener DB i.d.R. kein SSL nötig. Bei Managed-DB ggf. aktivieren:
  // ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unerwarteter Fehler im DB-Pool:', err);
});

export const query = (text, params) => pool.query(text, params);
