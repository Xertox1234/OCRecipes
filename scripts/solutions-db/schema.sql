-- scripts/solutions-db/schema.sql
-- Run as a Postgres SUPERUSER (CREATE EXTENSION / CREATE ROLE require it):
--   createdb ocrecipes_solutions   # one-time
--   npm run solutions:db:init
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN CREATE TYPE track_enum AS ENUM ('bug','knowledge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE category_enum AS ENUM
  ('logic-errors','runtime-errors','code-quality','performance-issues',
   'conventions','design-patterns','best-practices');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS solutions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path     text UNIQUE NOT NULL,
  slug            text NOT NULL,
  title           text NOT NULL,
  track           track_enum NOT NULL,
  category        category_enum NOT NULL,
  module          text,
  severity        text,
  tags            text[] NOT NULL DEFAULT '{}',
  symptoms        text[] NOT NULL DEFAULT '{}',
  applies_to      text[] NOT NULL DEFAULT '{}',
  created         date NOT NULL,
  last_updated    date,
  body            text NOT NULL,
  sections        jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash    text NOT NULL,
  embedding       vector(1536),
  embedding_model text,
  tsv             tsvector GENERATED ALWAYS AS
                    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) STORED,
  warnings        text[] NOT NULL DEFAULT '{}',
  extra_fields    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

-- SP2: ensure extra_fields exists on a pre-SP2 table (no-op on a fresh CREATE above).
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS solutions_embedding_hnsw ON solutions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS solutions_tsv_gin       ON solutions USING gin (tsv);
CREATE INDEX IF NOT EXISTS solutions_tags_gin      ON solutions USING gin (tags);
CREATE INDEX IF NOT EXISTS solutions_symptoms_gin  ON solutions USING gin (symptoms);
CREATE INDEX IF NOT EXISTS solutions_title_trgm    ON solutions USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS solutions_track_idx     ON solutions (track);
CREATE INDEX IF NOT EXISTS solutions_category_idx  ON solutions (category);
CREATE INDEX IF NOT EXISTS solutions_module_idx    ON solutions (module);
CREATE INDEX IF NOT EXISTS solutions_created_idx   ON solutions (created);

-- Read-only role for the MCP server (idempotent).
DO $$ BEGIN CREATE ROLE solutions_ro LOGIN PASSWORD 'solutions_ro';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT CONNECT ON DATABASE ocrecipes_solutions TO solutions_ro;
GRANT USAGE ON SCHEMA public TO solutions_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO solutions_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO solutions_ro;
