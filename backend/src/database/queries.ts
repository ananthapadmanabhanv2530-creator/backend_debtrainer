import { query } from './connection';

// ============================================
// User Queries
// ============================================

export const userQueries = {
  upsert: async (firebaseUid: string, name: string, email: string, profilePhoto?: string) => {
    const cleanEmail = (email || '').trim().toLowerCase();

    // Check if user already exists by firebase_uid or by email
    const existing = await query(
      `SELECT * FROM users WHERE firebase_uid = $1 OR (email IS NOT NULL AND LOWER(email) = $2 AND $2 != '')`,
      [firebaseUid, cleanEmail]
    );

    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      const updated = await query(
        `UPDATE users SET
           firebase_uid = $1,
           name = COALESCE(NULLIF($2, ''), users.name),
           email = COALESCE(NULLIF($3, ''), users.email),
           profile_photo = COALESCE($4, users.profile_photo),
           last_login = NOW()
         WHERE id = $5
         RETURNING *`,
        [firebaseUid, name || '', cleanEmail || u.email, profilePhoto || null, u.id]
      );
      return updated.rows[0];
    }

    const result = await query(
      `INSERT INTO users (firebase_uid, name, email, profile_photo, last_login)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [firebaseUid, name || 'User', cleanEmail, profilePhoto || null]
    );
    return result.rows[0];
  },

  findByFirebaseUid: async (firebaseUid: string) => {
    const result = await query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
    return result.rows[0] || null;
  },

  findById: async (id: number) => {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
};

// ============================================
// Debate Queries
// ============================================

export const debateQueries = {
  create: async (
    userId: number,
    topic: string,
    category: string,
    difficulty: string,
    userSide: string,
    aiSide: string,
    config: Record<string, any> = {}
  ) => {
    const result = await query(
      `INSERT INTO debates (user_id, topic, category, difficulty, user_side, ai_side, config, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active', NOW())
       RETURNING *`,
      [userId, topic, category, difficulty, userSide, aiSide, JSON.stringify(config)]
    );
    return result.rows[0];
  },

  findById: async (id: number) => {
    const result = await query('SELECT * FROM debates WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  findByUserId: async (
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      status?: string;
      category?: string;
      difficulty?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    } = {}
  ) => {
    const {
      limit = 20,
      offset = 0,
      status,
      category,
      difficulty,
      search,
      sortBy = 'started_at',
      sortOrder = 'DESC',
    } = options;

    let whereClause = 'WHERE d.user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND d.status = $${paramIndex++}`;
      params.push(status);
    }
    if (category) {
      whereClause += ` AND d.category = $${paramIndex++}`;
      params.push(category);
    }
    if (difficulty) {
      whereClause += ` AND d.difficulty = $${paramIndex++}`;
      params.push(difficulty);
    }
    if (search) {
      whereClause += ` AND d.topic ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    const allowedSortColumns = ['started_at', 'overall_score', 'duration', 'topic'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'started_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await query(
      `SELECT COUNT(*) FROM debates d ${whereClause}`,
      params
    );

    params.push(limit, offset);
    const result = await query(
      `SELECT d.*, f.overall_score as feedback_score
       FROM debates d
       LEFT JOIN feedback f ON f.debate_id = d.id
       ${whereClause}
       ORDER BY d.${safeSortBy} ${safeSortOrder}
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );

    return {
      debates: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit,
      offset,
    };
  },

  update: async (id: number, fields: Record<string, any>) => {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');

    const result = await query(
      `UPDATE debates SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return result.rows[0];
  },

  delete: async (id: number, userId: number) => {
    const result = await query(
      'DELETE FROM debates WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return result.rows[0] || null;
  },
};

// ============================================
// Message Queries
// ============================================

export const messageQueries = {
  create: async (debateId: number, role: string, message: string) => {
    const result = await query(
      `INSERT INTO messages (debate_id, role, message, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [debateId, role, message]
    );
    return result.rows[0];
  },

  findByDebateId: async (debateId: number) => {
    const result = await query(
      'SELECT * FROM messages WHERE debate_id = $1 ORDER BY created_at ASC',
      [debateId]
    );
    return result.rows;
  },
};

// ============================================
// Feedback Queries
// ============================================

export const feedbackQueries = {
  create: async (
    debateId: number,
    scores: {
      logicScore: number;
      evidenceScore: number;
      clarityScore: number;
      confidenceScore: number;
      persuasionScore: number;
      overallScore: number;
      strengths: string[];
      weaknesses: string[];
      suggestions: string[];
    }
  ) => {
    const result = await query(
      `INSERT INTO feedback (
        debate_id, logic_score, evidence_score, clarity_score,
        confidence_score, persuasion_score, overall_score,
        strengths, weaknesses, suggestions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        debateId,
        scores.logicScore,
        scores.evidenceScore,
        scores.clarityScore,
        scores.confidenceScore,
        scores.persuasionScore,
        scores.overallScore,
        scores.strengths,
        scores.weaknesses,
        scores.suggestions,
      ]
    );
    return result.rows[0];
  },

  findByDebateId: async (debateId: number) => {
    const result = await query('SELECT * FROM feedback WHERE debate_id = $1', [debateId]);
    return result.rows[0] || null;
  },
};

// ============================================
// Statistics Queries
// ============================================

export const statisticsQueries = {
  getOrCreate: async (userId: number) => {
    const result = await query(
      `INSERT INTO statistics (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET last_updated = NOW()
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  },

  update: async (userId: number, fields: Record<string, any>) => {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');

    const result = await query(
      `UPDATE statistics SET ${setClause}, last_updated = NOW() WHERE user_id = $1 RETURNING *`,
      [userId, ...values]
    );
    return result.rows[0];
  },

  recalculate: async (userId: number) => {
    const statsResult = await query(
      `SELECT
        COUNT(*) as total_debates,
        COALESCE(AVG(f.overall_score), 0) as average_score,
        COALESCE(MAX(f.overall_score), 0) as best_score
      FROM debates d
      LEFT JOIN feedback f ON f.debate_id = d.id
      WHERE d.user_id = $1 AND d.status = 'completed'`,
      [userId]
    );

    const topicResult = await query(
      `SELECT topic, COUNT(*) as count
       FROM debates WHERE user_id = $1
       GROUP BY topic ORDER BY count DESC LIMIT 1`,
      [userId]
    );

    const stats = statsResult.rows[0];
    const favoriteTopic = topicResult.rows[0]?.topic || null;

    // Calculate streak
    const streakResult = await query(
      `SELECT DATE(started_at) as debate_date
       FROM debates
       WHERE user_id = $1 AND status = 'completed'
       ORDER BY started_at DESC`,
      [userId]
    );

    let streak = 0;
    if (streakResult.rows.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = today;

      for (const row of streakResult.rows) {
        const debateDate = new Date(row.debate_date);
        debateDate.setHours(0, 0, 0, 0);
        const diffDays = Math.floor(
          (checkDate.getTime() - debateDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (diffDays <= 1) {
          streak++;
          checkDate = debateDate;
        } else {
          break;
        }
      }
    }

    const result = await query(
      `INSERT INTO statistics (user_id, total_debates, average_score, best_score, favorite_topic, current_streak, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         total_debates = $2,
         average_score = $3,
         best_score = $4,
         favorite_topic = $5,
         current_streak = $6,
         last_updated = NOW()
       RETURNING *`,
      [
        userId,
        parseInt(stats.total_debates),
        parseFloat(stats.average_score),
        parseFloat(stats.best_score),
        favoriteTopic,
        streak,
      ]
    );
    return result.rows[0];
  },

  getAnalytics: async (userId: number) => {
    // Score trends over time
    const trendsResult = await query(
      `SELECT d.id, d.topic, d.category, d.started_at, d.difficulty,
              f.overall_score, f.logic_score, f.evidence_score,
              f.clarity_score, f.confidence_score, f.persuasion_score
       FROM debates d
       JOIN feedback f ON f.debate_id = d.id
       WHERE d.user_id = $1 AND d.status = 'completed'
       ORDER BY d.started_at ASC`,
      [userId]
    );

    // Category breakdown
    const categoryResult = await query(
      `SELECT d.category, COUNT(*) as count,
              COALESCE(AVG(f.overall_score), 0) as avg_score
       FROM debates d
       LEFT JOIN feedback f ON f.debate_id = d.id
       WHERE d.user_id = $1 AND d.status = 'completed'
       GROUP BY d.category
       ORDER BY count DESC`,
      [userId]
    );

    // Difficulty breakdown
    const difficultyResult = await query(
      `SELECT d.difficulty, COUNT(*) as count,
              COALESCE(AVG(f.overall_score), 0) as avg_score
       FROM debates d
       LEFT JOIN feedback f ON f.debate_id = d.id
       WHERE d.user_id = $1 AND d.status = 'completed'
       GROUP BY d.difficulty`,
      [userId]
    );

    return {
      trends: trendsResult.rows,
      categoryBreakdown: categoryResult.rows,
      difficultyBreakdown: difficultyResult.rows,
    };
  },
};
