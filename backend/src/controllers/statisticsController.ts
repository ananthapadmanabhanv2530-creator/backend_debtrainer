import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { statisticsQueries } from '../database/queries';

export const statisticsController = {
  // GET /statistics
  getStats: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const stats = await statisticsQueries.getOrCreate(req.user!.id);

      res.json({
        success: true,
        statistics: {
          totalDebates: stats.total_debates,
          averageScore: parseFloat(stats.average_score) || 0,
          bestScore: parseFloat(stats.best_score) || 0,
          favoriteTopic: stats.favorite_topic,
          currentStreak: stats.current_streak,
          lastUpdated: stats.last_updated,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /analytics
  getAnalytics: async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const analytics = await statisticsQueries.getAnalytics(req.user!.id);

      res.json({
        success: true,
        analytics: {
          trends: analytics.trends.map((t: any) => ({
            id: t.id,
            topic: t.topic,
            category: t.category,
            date: t.started_at,
            difficulty: t.difficulty,
            overallScore: parseFloat(t.overall_score) || 0,
            logicScore: parseFloat(t.logic_score) || 0,
            evidenceScore: parseFloat(t.evidence_score) || 0,
            clarityScore: parseFloat(t.clarity_score) || 0,
            confidenceScore: parseFloat(t.confidence_score) || 0,
            persuasionScore: parseFloat(t.persuasion_score) || 0,
          })),
          categoryBreakdown: analytics.categoryBreakdown.map((c: any) => ({
            category: c.category,
            count: parseInt(c.count),
            avgScore: parseFloat(c.avg_score) || 0,
          })),
          difficultyBreakdown: analytics.difficultyBreakdown.map((d: any) => ({
            difficulty: d.difficulty,
            count: parseInt(d.count),
            avgScore: parseFloat(d.avg_score) || 0,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
