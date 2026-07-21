import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Public — these verify the token themselves
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);

// Protected — requires auth middleware
router.get('/me', authMiddleware, authController.me);

export default router;
