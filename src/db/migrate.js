require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool, testConnection } = require('./index');

async function migrate() {
  console.log('[Migration] Starte...');
  const ok = await testConnection();
  if (!ok) { process.exit(1); }

  const sql    = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[Migration] ✅ Fertig.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] ❌', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
migrate();
