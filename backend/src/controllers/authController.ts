import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { getAuth } from '../config/firebase';
import { userQueries } from '../database/queries';
import { statisticsQueries } from '../database/queries';
import { UnauthorizedError } from '../utils/errors';

export const authController = {
  // POST /auth/login — Verify Firebase token and upsert user
  login: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedError('No token provided');
      }

      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await getAuth().verifyIdToken(token);

      const { uid, email, name, picture } = decodedToken;

      const user = await userQueries.upsert(
        uid,
        name || email?.split('@')[0] || 'User',
        email || '',
        picture || undefined
      );

      // Ensure statistics record exists
      await statisticsQueries.getOrCreate(user.id);

      res.json({
        success: true,
        user: {
          id: user.id,
          firebaseUid: user.firebase_uid,
          name: user.name,
          email: user.email,
          profilePhoto: user.profile_photo,
          createdAt: user.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /auth/google — Same flow for Google login
  googleLogin: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedError('No token provided');
      }

      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await getAuth().verifyIdToken(token);

      const { uid, email, name, picture } = decodedToken;

      const user = await userQueries.upsert(
        uid,
        name || 'User',
        email || '',
        picture || undefined
      );

      await statisticsQueries.getOrCreate(user.id);

      res.json({
        success: true,
        user: {
          id: user.id,
          firebaseUid: user.firebase_uid,
          name: user.name,
          email: user.email,
          profilePhoto: user.profile_photo,
          createdAt: user.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /auth/me — Get current user profile
  me: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError();
      }

      const user = await userQueries.findByFirebaseUid(req.user.uid);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          firebaseUid: user.firebase_uid,
          name: user.name,
          email: user.email,
          profilePhoto: user.profile_photo,
          createdAt: user.created_at,
          lastLogin: user.last_login,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
