const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'reifenpro',
  user:     process.env.DB_USER     || 'reifenpro_user',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => console.error('[DB] Pool-Fehler:', err));

const query = (text, params) => pool.query(text, params);

const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const testConnection = async () => {
  try {
    const r = await query('SELECT current_database() as db');
    console.log(`[DB] Verbunden mit: ${r.rows[0].db}`);
    return true;
  } catch (err) {
    console.error('[DB] Fehler:', err.message);
    return false;
  }
};

module.exports = { query, withTransaction, testConnection, pool };
