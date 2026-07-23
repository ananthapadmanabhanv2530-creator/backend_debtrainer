import { Pool } from 'pg';
import { config } from '../config/index';

const isRender = config.databaseUrl.includes('render.com');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: isRender ? 30000 : 5000,
  ssl: isRender ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Test connection with retry for flaky Render external access
const testConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      const res = await client.query('SELECT NOW()');
      await client.query("ALTER TABLE debates ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';");
      client.release();
      console.log(`✅ Database connected (attempt ${i + 1}) and schema verified`);
      return true;
    } catch (err: any) {
      console.warn(`⚠️  DB connection attempt ${i + 1}/${retries} failed: ${err.message}`);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
  }
  console.error('❌ Could not connect to database after retries');
  return false;
};

testConnection();

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export const getClient = () => {
  return pool.connect();
};
