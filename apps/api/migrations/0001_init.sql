CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,              -- file slug, e.g. "2026-03-04-product-sync"
  title text NOT NULL,
  source_filename text NOT NULL,
  turn_count int NOT NULL,
  duration_seconds int NOT NULL,          -- last turn start_seconds
  speakers text[] NOT NULL,               -- distinct, in order of first appearance
  extraction_status text NOT NULL CHECK (extraction_status IN ('pending','done','failed','skipped')),
  extraction_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE turns (
  id text PRIMARY KEY,                    -- "<slug>#<n>", n is 1-based
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  n int NOT NULL,
  speaker text NOT NULL,
  start_seconds int NOT NULL,
  timestamp_label text NOT NULL,          -- "hh:mm:ss" as written
  text text NOT NULL,
  UNIQUE (meeting_id, n)
);
CREATE INDEX turns_meeting_n ON turns (meeting_id, n);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  first_turn_n int NOT NULL,
  last_turn_n int NOT NULL,
  start_seconds int NOT NULL,
  end_seconds int NOT NULL,               -- start_seconds of last turn in the chunk
  speakers text[] NOT NULL,
  content text NOT NULL,                  -- "Speaker: text\n" per turn, no timestamps
  embedding vector(384) NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX chunks_meeting ON chunks (meeting_id);
CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text text NOT NULL,
  turn_id text REFERENCES turns(id),      -- null if the model cited an id we could not validate
  position int NOT NULL
);

CREATE TABLE action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text text NOT NULL,
  owner text,                             -- speaker name or null
  due text,                               -- free text as said in the meeting; never parsed to a date
  turn_id text REFERENCES turns(id),
  position int NOT NULL
);
CREATE INDEX decisions_meeting ON decisions (meeting_id);
CREATE INDEX action_items_meeting ON action_items (meeting_id);

CREATE TABLE query_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  question text NOT NULL,
  meeting_ids uuid[],                     -- null = all meetings
  mode text NOT NULL CHECK (mode IN ('retrieval-only','full')),
  retrieval jsonb NOT NULL,               -- RankedChunk[] exactly as sent to the client
  refused boolean NOT NULL DEFAULT false,
  refusal_reason text,                    -- 'below_threshold' | 'model_declined' | null
  answer text,
  citations jsonb,                        -- Citation[] after validation
  dropped_citations text[],               -- ids the model cited that were not in the retrieved set
  model text,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  embed_ms int NOT NULL,
  search_ms int NOT NULL,
  llm_ms int,
  total_ms int NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_traces_created ON query_traces (created_at DESC);
