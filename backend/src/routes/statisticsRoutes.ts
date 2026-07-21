import { Router } from 'express';
import { statisticsController } from '../controllers/statisticsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', statisticsController.getStats);
router.get('/analytics', statisticsController.getAnalytics);

export default router;
