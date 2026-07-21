import admin from 'firebase-admin';
import { config } from './index';
import * as fs from 'fs';
import * as path from 'path';

let firebaseApp: admin.app.App;

export const initializeFirebase = () => {
  if (admin.apps.length > 0) {
    firebaseApp = admin.apps[0]!;
    return firebaseApp;
  }

  try {
    const serviceAccountPath = path.resolve(config.firebaseServiceAccountPath);

    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Support passing the JSON directly as an env var (for deployed environments)
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      console.warn('Firebase service account not found. Auth will not work.');
      firebaseApp = admin.initializeApp();
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    firebaseApp = admin.initializeApp();
  }

  return firebaseApp;
};

export const getAuth = () => admin.auth();
