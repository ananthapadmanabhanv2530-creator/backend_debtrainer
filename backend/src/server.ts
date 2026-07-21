import app from './app';
import { config } from './config';
import { initializeFirebase } from './config/firebase';
import pool from './database/connection';

const startServer = async () => {
  try {
    // Test database connection
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected');
    client.release();

    // Initialize Firebase Admin
    initializeFirebase();
    console.log('✅ Firebase Admin initialized');

    // Start server
    app.listen(config.port, () => {
      console.log(`\n🚀 AI Debate Trainer API running on port ${config.port}`);
      console.log(`   Environment: ${config.nodeEnv}`);
      console.log(`   Health: http://localhost:${config.port}/health\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
