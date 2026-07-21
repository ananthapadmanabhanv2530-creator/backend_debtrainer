import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || '';
console.log('🔍 Testing database connection...');
console.log('   URL:', DATABASE_URL.replace(/:([^@]+)@/, ':***@'));

async function run() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  });

  try {
    console.log('   Connecting...');
    const client = await pool.connect();
    console.log('✅ Connected!');

    const timeResult = await client.query('SELECT NOW() as t');
    console.log('   Server time:', timeResult.rows[0].t);

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('✅ Schema applied!');

    // Verify
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('📋 Tables:');
    tables.rows.forEach((r: any) => console.log('   -', r.table_name));

    client.release();
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    if (err.code) console.error('   Code:', err.code);
  } finally {
    await pool.end();
  }
}

run();
