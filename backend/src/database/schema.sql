-- ============================================
-- AI Debate Trainer - PostgreSQL Schema
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  profile_photo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW()
);

-- Debates table
CREATE TABLE IF NOT EXISTS debates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  category VARCHAR(100),
  difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
  user_side VARCHAR(10) NOT NULL CHECK (user_side IN ('support', 'oppose')),
  ai_side VARCHAR(10) NOT NULL CHECK (ai_side IN ('support', 'oppose')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration INTEGER,
  overall_score DECIMAL(4,1),
  config JSONB DEFAULT '{}'
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  debate_id INTEGER REFERENCES debates(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  debate_id INTEGER REFERENCES debates(id) ON DELETE CASCADE UNIQUE,
  logic_score DECIMAL(4,1),
  evidence_score DECIMAL(4,1),
  clarity_score DECIMAL(4,1),
  confidence_score DECIMAL(4,1),
  persuasion_score DECIMAL(4,1),
  overall_score DECIMAL(4,1),
  strengths TEXT[],
  weaknesses TEXT[],
  suggestions TEXT[]
);

-- Statistics table
CREATE TABLE IF NOT EXISTS statistics (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  total_debates INTEGER DEFAULT 0,
  average_score DECIMAL(4,1) DEFAULT 0,
  best_score DECIMAL(4,1) DEFAULT 0,
  favorite_topic VARCHAR(255),
  current_streak INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_debates_user_id ON debates(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_debate_id ON messages(debate_id);
CREATE INDEX IF NOT EXISTS idx_debates_status ON debates(status);
CREATE INDEX IF NOT EXISTS idx_debates_started_at ON debates(started_at);
