-- ============================================================
-- AI Knowledge Base — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 2. knowledge_base
--    Stores authoritative content with semantic embeddings
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),          -- OpenAI / nomic-embed-text-v1 dim
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for fast ANN search (build after inserting data)
CREATE INDEX IF NOT EXISTS knowledge_base_embedding_idx
  ON knowledge_base
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- 3. intent_groups
--    Clusters semantically equivalent questions
-- ============================================================
CREATE TABLE IF NOT EXISTS intent_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. question_history
--    Every Q&A pair ever answered
-- ============================================================
CREATE TABLE IF NOT EXISTS question_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT,                          -- anonymous session id
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  source          TEXT CHECK (source IN ('knowledge_base', 'ai_generated')),
  intent_group_id UUID REFERENCES intent_groups (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. question_variations
--    Alternative phrasings of the same intent, with embeddings
-- ============================================================
CREATE TABLE IF NOT EXISTS question_variations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_group_id UUID NOT NULL REFERENCES intent_groups (id) ON DELETE CASCADE,
  variation_text  TEXT NOT NULL,
  embedding       VECTOR(1536),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS question_variations_embedding_idx
  ON question_variations
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ============================================================
-- 6. RPC: match_knowledge
--    Similarity search over knowledge_base
-- ============================================================
CREATE OR REPLACE FUNCTION match_knowledge (
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.75,
  match_count     INT   DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    kb.id,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 7. RPC: match_variations
--    Similarity search over question_variations
-- ============================================================
CREATE OR REPLACE FUNCTION match_variations (
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.80,
  match_count     INT   DEFAULT 3
)
RETURNS TABLE (
  id              UUID,
  intent_group_id UUID,
  variation_text  TEXT,
  similarity      FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    qv.id,
    qv.intent_group_id,
    qv.variation_text,
    1 - (qv.embedding <=> query_embedding) AS similarity
  FROM question_variations qv
  WHERE 1 - (qv.embedding <=> query_embedding) > match_threshold
  ORDER BY qv.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 8. Seed: a handful of demo knowledge entries
--    (embeddings are null until you run your ingest script)
-- ============================================================
INSERT INTO knowledge_base (content, metadata) VALUES
  (
    'This is an AI-powered knowledge base that answers questions using stored knowledge. When no stored answer is found, it falls back to an AI model to generate a response. Every answer is saved and indexed for future queries.',
    '{"topic": "product", "tags": ["about", "overview"]}'
  ),
  (
    'To add knowledge to the system, insert rows into the knowledge_base table in Supabase with the content field filled in. Embeddings are generated automatically by the API on the next ingest run.',
    '{"topic": "admin", "tags": ["setup", "ingestion"]}'
  ),
  (
    'The app uses vector similarity search (pgvector) to find the most semantically relevant answer. A cosine similarity threshold of 0.75 is used — questions below this threshold are sent to the AI fallback.',
    '{"topic": "technical", "tags": ["vector", "search", "pgvector"]}'
  )
ON CONFLICT DO NOTHING;
