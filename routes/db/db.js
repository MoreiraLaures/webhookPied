require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

module.exports = { query };