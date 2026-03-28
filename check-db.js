const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("Tables:");
    console.table(res.rows);
    
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'clients'");
    console.log("Columns in clients:");
    console.table(cols.rows);
  } catch (err) {
    console.error("DB CHECK ERROR:", err);
  } finally {
    await pool.end();
  }
}

check();
