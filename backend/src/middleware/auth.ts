import { Request, Response, NextFunction } from 'express';
import { getAuth } from '../config/firebase';
import { userQueries } from '../database/queries';
import { UnauthorizedError } from '../utils/errors';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    id: number;
    email: string;
    name: string;
  };
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split('Bearer ')[1];

    if (!token) {
      throw new UnauthorizedError('Invalid token format');
    }

    const decodedToken = await getAuth().verifyIdToken(token);

    const dbUser = await userQueries.findByFirebaseUid(decodedToken.uid);

    if (!dbUser) {
      throw new UnauthorizedError('User not found in database. Please login first.');
    }

    req.user = {
      uid: decodedToken.uid,
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError('Invalid or expired token'));
    }
  }
};
