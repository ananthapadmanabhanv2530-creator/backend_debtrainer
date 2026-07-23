import { Router } from 'express';
import { debateController } from '../controllers/debateController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

// All debate routes require authentication
router.use(authMiddleware);

const startDebateSchema = z.object({
  topic: z.string().min(5, 'Topic must be at least 5 characters'),
  category: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),
  userSide: z.enum(['support', 'oppose', 'random']),
  config: z.record(z.any()).optional(),
});

const sendMessageSchema = z.object({
  debateId: z.number().int().positive(),
  message: z.string().min(1, 'Message cannot be empty'),
});

const endDebateSchema = z.object({
  debateId: z.number().int().positive(),
});

const hintSchema = z.object({
  debateId: z.number().int().positive(),
  hintType: z.enum(['keyword', 'outline', 'counterArgument', 'evidence', 'socratic']).optional(),
});

const correctSpeechSchema = z.object({
  transcript: z.string().min(1, 'Transcript cannot be empty'),
  topic: z.string().optional(),
});

router.post('/start', validate(startDebateSchema), debateController.start);
router.post('/message', validate(sendMessageSchema), debateController.sendMessage);
router.post('/end', validate(endDebateSchema), debateController.end);
router.post('/hint', validate(hintSchema), debateController.hint);
router.post('/correct-speech', validate(correctSpeechSchema), debateController.correctSpeech);
router.get('/history', debateController.getHistory);
router.get('/:id', debateController.getById);
router.delete('/:id', debateController.delete);

export default router;
