import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { debateQueries, messageQueries, feedbackQueries } from '../database/queries';
import { statisticsQueries } from '../database/queries';
import { geminiService } from '../services/geminiService';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';

export const debateController = {
  // POST /debate/start
  start: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { topic, category, difficulty, userSide, config } = req.body;

      // Determine sides
      let finalUserSide = userSide;
      if (userSide === 'random') {
        finalUserSide = Math.random() < 0.5 ? 'support' : 'oppose';
      }
      const aiSide = finalUserSide === 'support' ? 'oppose' : 'support';

      // Create debate record
      const debate = await debateQueries.create(
        req.user!.id,
        topic,
        category || 'General',
        difficulty || 'medium',
        finalUserSide,
        aiSide,
        config || {}
      );

      // Generate AI opening argument
      const aiOpening = await geminiService.startDebate(topic, aiSide, difficulty || 'medium');

      // Save AI opening message
      await messageQueries.create(debate.id, 'assistant', aiOpening);

      res.status(201).json({
        success: true,
        debate: {
          id: debate.id,
          topic: debate.topic,
          category: debate.category,
          difficulty: debate.difficulty,
          userSide: debate.user_side,
          aiSide: debate.ai_side,
          status: debate.status,
          startedAt: debate.started_at,
          config: debate.config || {},
        },
        message: {
          role: 'assistant',
          message: aiOpening,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /debate/message
  sendMessage: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { debateId, message } = req.body;

      // Verify debate exists and belongs to user
      const debate = await debateQueries.findById(debateId);
      if (!debate) {
        throw new NotFoundError('Debate not found');
      }
      if (debate.user_id !== req.user!.id) {
        throw new ForbiddenError('Not your debate');
      }
      if (debate.status !== 'active') {
        throw new ValidationError('Debate is not active');
      }

      // Save user message
      await messageQueries.create(debateId, 'user', message);

      // Get debate history
      const history = await messageQueries.findByDebateId(debateId);
      const formattedHistory = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        message: m.message,
      }));

      // Get AI response
      const aiResponse = await geminiService.continueDebate(
        debate.topic,
        debate.ai_side,
        debate.difficulty,
        formattedHistory,
        message
      );

      // Save AI response
      const aiMessage = await messageQueries.create(debateId, 'assistant', aiResponse);

      res.json({
        success: true,
        message: {
          id: aiMessage.id,
          role: 'assistant',
          message: aiResponse,
          createdAt: aiMessage.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /debate/end
  end: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { debateId } = req.body;

      const debate = await debateQueries.findById(debateId);
      if (!debate) {
        throw new NotFoundError('Debate not found');
      }
      if (debate.user_id !== req.user!.id) {
        throw new ForbiddenError('Not your debate');
      }
      if (debate.status !== 'active') {
        throw new ValidationError('Debate is already ended');
      }

      // Get debate history for evaluation
      const history = await messageQueries.findByDebateId(debateId);
      const formattedHistory = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        message: m.message,
      }));

      // Generate AI evaluation
      const evaluation = await geminiService.evaluateDebate(
        debate.topic,
        debate.user_side,
        debate.difficulty,
        formattedHistory
      );

      // Save feedback
      await feedbackQueries.create(debateId, evaluation);

      // Calculate duration
      const startTime = new Date(debate.started_at).getTime();
      const duration = Math.floor((Date.now() - startTime) / 1000);

      // Update debate status
      await debateQueries.update(debateId, {
        status: 'completed',
        ended_at: new Date().toISOString(),
        duration,
        overall_score: evaluation.overallScore,
      });

      // Recalculate user statistics
      await statisticsQueries.recalculate(req.user!.id);

      res.json({
        success: true,
        evaluation,
        duration,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /debate/history
  getHistory: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const {
        limit = '20',
        offset = '0',
        status,
        category,
        difficulty,
        search,
        sortBy,
        sortOrder,
      } = req.query;

      const result = await debateQueries.findByUserId(req.user!.id, {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        status: status as string,
        category: category as string,
        difficulty: difficulty as string,
        search: search as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /debate/:id
  getById: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const debateId = parseInt(req.params.id as string, 10);
      const debate = await debateQueries.findById(debateId);

      if (!debate) {
        throw new NotFoundError('Debate not found');
      }
      if (debate.user_id !== req.user!.id) {
        throw new ForbiddenError('Not your debate');
      }

      const messages = await messageQueries.findByDebateId(debateId);
      const feedback = await feedbackQueries.findByDebateId(debateId);

      res.json({
        success: true,
        debate: {
          id: debate.id,
          topic: debate.topic,
          category: debate.category,
          difficulty: debate.difficulty,
          userSide: debate.user_side,
          aiSide: debate.ai_side,
          status: debate.status,
          startedAt: debate.started_at,
          endedAt: debate.ended_at,
          duration: debate.duration,
          overallScore: debate.overall_score,
          config: debate.config || {},
        },
        messages: messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          message: m.message,
          createdAt: m.created_at,
        })),
        feedback: feedback
          ? {
              logicScore: feedback.logic_score,
              evidenceScore: feedback.evidence_score,
              clarityScore: feedback.clarity_score,
              confidenceScore: feedback.confidence_score,
              persuasionScore: feedback.persuasion_score,
              overallScore: feedback.overall_score,
              strengths: feedback.strengths,
              weaknesses: feedback.weaknesses,
              suggestions: feedback.suggestions,
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  },

  // DELETE /debate/:id
  delete: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const debateId = parseInt(req.params.id as string, 10);
      const deleted = await debateQueries.delete(debateId, req.user!.id);

      if (!deleted) {
        throw new NotFoundError('Debate not found');
      }

      // Recalculate statistics after deletion
      await statisticsQueries.recalculate(req.user!.id);

      res.json({
        success: true,
        message: 'Debate deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /debate/hint
  hint: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { debateId, hintType } = req.body;

      const debate = await debateQueries.findById(debateId);
      if (!debate) {
        throw new NotFoundError('Debate not found');
      }
      if (debate.user_id !== req.user!.id) {
        throw new ForbiddenError('Not your debate');
      }
      if (debate.status !== 'active') {
        throw new ValidationError('Debate is not active');
      }

      // Check if hints are enabled in config
      const config = debate.config || {};
      if (config.hints && !config.hints.enabled) {
        throw new ValidationError('Hints are disabled for this debate');
      }

      // Get debate history for context
      const history = await messageQueries.findByDebateId(debateId);
      const formattedHistory = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        message: m.message,
      }));

      const hint = await geminiService.generateHint(
        debate.topic,
        debate.user_side,
        debate.difficulty,
        formattedHistory,
        hintType || 'keyword'
      );

      res.json({
        success: true,
        hint,
        hintType: hintType || 'keyword',
      });
    } catch (error) {
      next(error);
    }
  },
};
