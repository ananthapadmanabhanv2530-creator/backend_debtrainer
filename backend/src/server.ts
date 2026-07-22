import app from './app';
import { config } from './config';
import { initializeFirebase } from './config/firebase';

const startServer = async () => {
  try {
    // Initialize Firebase Admin
    initializeFirebase();
    console.log('✅ Firebase Admin initialized');

    // Start server — DB connection is tested separately with retries in connection.ts
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
