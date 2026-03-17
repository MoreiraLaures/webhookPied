const { Pool } = require('pg');

const pool = new Pool({
  host: '100.121.143.49',
  port: 5432,
  user: 'postgres',
  password: '3131',
  database: 'db_suno'
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

module.exports = { query };
