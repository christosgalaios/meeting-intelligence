# Architecture

How the pieces fit and what happens on each request. The decisions behind it are in `docs/adr/`. The frozen API contract is in `docs/spec.md`, section 5.

## Containers

Three containers, started by `docker compose up`. Only the web container talks to a browser, and every port is bound to `127.0.0.1`.

```mermaid
flowchart LR
  B["Browser"] -->|"same origin, port 5173"| N["web: nginx + React build"]
  N -->|"/api, buffering off"| A["api: Fastify"]
  A --> P[("db: Postgres + pgvector")]
  A -->|"local, in process"| E["bge-small embeddings"]
  A -.->|"only if ANTHROPIC_API_KEY is set"| C["Claude API"]
  A -->|"worker thread"| W["voice: sherpa-onnx diarize + whisper"]
```

- `web` serves the static React app and proxies `/api` to the API. The API sends no CORS headers (ADR 0010).
- `api` owns the database, the embeddings and every model call. The key exists only in this process.
- `db` is `pgvector/pgvector:pg17`.
- All three have a healthcheck. `api` is healthy only when `GET /api/health` reports `status: ok` (database answering and embedding model loaded). The endpoint answers `503` with the same body while it is `degraded`, so any probe that reads only the status code gets the right answer, and the web app still reads the body to show its banner. Probes are logged at `warn`, so the 10 s healthcheck does not fill the log. `web` is healthy when nginx serves `/`.
- At boot the API logs `boot.migrated` with the migrations it applied (an empty list on a normal restart), then `boot.listening`, `boot.voice` and `boot.embeddings_ready`. Migrations take no advisory lock, so they assume one API replica.

## Ingest

An upload is parsed, chunked, embedded and stored in one request. Extraction runs after the response and only when a key is set.

```mermaid
flowchart TD
  U["POST /api/meetings"] --> V["2 MB check, zod schema, transcript validation, embeddings ready"]
  V --> S["pick slug: x, x-2, x-3"]
  S --> PA["parse turns: timestamp, speaker, text"]
  PA --> CH["chunk: up to 6 turns or 180 words, overlap 2"]
  CH --> EM["embed chunks with bge-small, batches of 16"]
  EM --> TX["one transaction: meeting, turns, chunks"]
  TX --> R["201 with the meeting"]
  TX --> Q{"key set and not a seed?"}
  Q -->|yes| X["queue: Haiku extraction"]
  Q -->|no| SK["extraction_status = skipped"]
  X --> D["decisions and action items, unknown turn ids stored as null"]
```

- Turn ids are `<slug>#<n>`. The slug comes from the filename, so the same id is used in the database, the prompt and the UI anchor.
- Embedding is synchronous. A large file holds the request open. The transcript is validated, parsed, chunked and embedded once. Only the turn ids depend on the slug, so a slug clash with a concurrent upload re-runs the insert, not the embedding.
- The upload is validated before anything is embedded: a 422 `UNPROCESSABLE` for non-text, no turns, too few turns, too few timestamped lines or a turn over 2,000 words (`apps/api/src/transcript/validate.ts`). The parse is reused, not repeated.
- Extraction jobs are tracked by `JobTracker` (`apps/api/src/services/jobTracker.ts`). It is not a queue: each job starts at once and the tracker only lets tests and shutdown wait for them. The only real queue is the voice one.
- A pending extraction that is left over when the process dies is marked `failed: interrupted` at the next boot. Extraction is never retried automatically.
- Sample transcripts are loaded at start when `SEED_ON_START=true`. Seeding never calls the model.

## Voice

Audio becomes a draft transcript that the user reviews, and only then goes through the same ingest path as a text upload (ADR 0011).

```mermaid
flowchart TD
  F["audio file in the browser"] --> D["decode to 16 kHz mono WAV, refuse over 30 min"]
  D --> PO["POST /api/transcriptions, 202"]
  PO --> Q["in-memory queue, one job at a time, max 4"]
  Q --> WK["worker thread: diarize, merge turns, Whisper per turn"]
  WK --> DR["GET /api/transcriptions/:id: draft with speakers"]
  DR --> RV["review: rename, merge, re-run with N speakers"]
  RV -->|"Import"| IN["POST /api/meetings, the normal ingest"]
```

- The audio is never written to disk or the database. The draft lives in API memory.
- Jobs are lost on an API restart; the browser gets a 404 and offers a retry from the audio it still holds.
- One job runs at a time because two would halve each other's speed and double peak memory. The queue position is shown to the user.
- A 30 minute cap applies because memory was measured only up to a 95 second clip. Longer audio is refused, not attempted.
- Nothing is ingested until the user clicks Import, and the API's own transcript validator still runs then.

## Ask

```mermaid
flowchart TD
  Q["POST /api/ask"] --> V["zod schema, embeddings ready, resolve meeting scope"]
  V --> EQ["embed the question with the bge query prefix"]
  EQ --> VS["vector top 20"]
  EQ --> FS["full-text top 20, OR query"]
  VS --> RRF["RRF, k = 60, top 8 chunks"]
  FS --> RRF
  RRF --> TU["expand chunks to distinct turns, score each turn against the question"]
  TU --> T1["insert trace row"]
  T1 --> G{"top vector score below 0.58 and no strict text hit?"}
  G -->|yes| RF["refusal event, no model call"]
  G -->|no| M{"mode"}
  M -->|"retrieval-only"| RO["done with answer null"]
  M -->|full| LL["stream Sonnet answer"]
  LL --> CV["validate citations against retrieved turns"]
  CV --> FT["update trace, done event"]
```

## SSE event sequence

`POST /api/ask` answers with `text/event-stream`. Each event is `event: <type>` and `data: <json>`. The API parses every event against the contract schema before sending it.

| Path | Events, in order |
|---|---|
| Full mode, answered | `meta`, `sources`, `token` (many), `done` |
| Full mode, below threshold | `meta`, `sources`, `refusal`, `done` (answer is `Not discussed in these meetings.`) |
| Retrieval-only | `meta`, `sources`, `done` (answer is `null`) |
| Failure after the stream opens | `meta`, `sources`, then `error` in place of `done` |

- `meta`: trace id, mode, answer model.
- `sources`: the 8 ranked chunks with their vector, text and RRF scores, and the turns inside them. Each turn carries a score, which is the cosine similarity of that turn's text to the question. The chunk-level RRF scores stay on the chunks, and the "Why this answer" panel shows both.
- `token`: a piece of answer text.
- `done`: the final answer, the valid citations, the dropped citation ids, the refusal reason, token usage and timings.
- Request errors found before the stream opens (bad input, unknown meeting, embeddings not ready) are plain JSON with status 400, 404 or 503.
- The stream sets `Cache-Control: no-cache` and `X-Accel-Buffering: no`, and nginx has proxy buffering off, so tokens reach the browser as they are produced.
- If the client disconnects, the API aborts the upstream model stream so it stops costing tokens.

## Data model

```mermaid
erDiagram
  meetings ||--o{ turns : has
  meetings ||--o{ chunks : has
  meetings ||--o{ decisions : has
  meetings ||--o{ action_items : has
  turns ||--o{ decisions : "cited by"
  turns ||--o{ action_items : "cited by"

  meetings {
    uuid id PK
    text slug UK
    text title
    int turn_count
    int duration_seconds
    text_array speakers
    text extraction_status "pending, done, failed, skipped"
    date meeting_date "from the filename, may be null"
  }
  turns {
    text id PK "slug#n"
    uuid meeting_id FK
    int n
    text speaker
    int start_seconds
    text timestamp_label
    text text
  }
  chunks {
    uuid id PK
    uuid meeting_id FK
    int first_turn_n
    int last_turn_n
    text content
    vector embedding "384, HNSW cosine"
    tsvector tsv "generated, GIN"
  }
  decisions {
    uuid id PK
    text text
    text turn_id FK "null if unverified"
  }
  action_items {
    uuid id PK
    text text
    text owner "null allowed"
    text due "as said, never parsed"
    text turn_id FK
  }
  query_traces {
    uuid id PK
    text request_id
    text question
    text mode
    jsonb retrieval
    bool refused
    text refusal_reason "below_threshold or model_declined"
    text answer
    jsonb citations
    text_array dropped_citations
    text model
    int input_tokens
    int output_tokens
    int embed_ms
    int search_ms
    int llm_ms
    int total_ms
    text error
  }
```

- `query_traces` has no foreign key. It holds a copy of what was retrieved and answered, so a trace survives a deleted meeting.
- Migrations are numbered SQL files in `apps/api/migrations/`. Each runs in a transaction at boot and is recorded in `schema_migrations`, so a second run applies nothing.

## Errors

- Every error body is `{ error: { code, message, requestId } }`. `requestId` is the `x-request-id` header and the `reqId` on every log line for that request.
- `VALIDATION` is `400`: the request itself is malformed (bad JSON, a body that fails its schema, a bad query value). `UNPROCESSABLE` is `422`: the request is well-formed but the file in it is unusable (not a transcript, no turns, not a usable WAV, audio under half a second). Other codes: `NOT_FOUND` 404, `TOO_LARGE` 413, `CONFLICT` 409, `LLM_ERROR` 502, `EMBEDDINGS_NOT_READY` 503, `INTERNAL` 500.
- An unexpected exception becomes `500 INTERNAL` with the message `Internal error`. The detail goes to the log only (tested in `apps/api/test/hardening.test.ts`).
- The web app shows `Ref: <id>` under every error it displays that came from the API: the request id, or for an error inside the answer stream the trace id from the `meta` event. Someone reporting a problem can quote it and it matches a log line or a trace row.

## Web app layering

Pages and components never call `fetch`. All HTTP goes through `apps/web/src/api/client.ts`, which validates every response with the same zod schemas as the API. Reads that several components share or that poll (`useMeetings`, `useMeeting`, `useHealth`, `useAsk`, `useTranscription`) live in hooks under `src/hooks/`. One-shot mutations the user starts with a click (upload, paste, import a reviewed draft, load the samples, start an extraction) call the client from the component or page that owns the button and keep their pending and error state locally. A hook for each would only wrap one call and one `useState`.

## Request lifecycle and the trace

Follow one question through `POST /api/ask` in full mode.

1. Fastify gives the request a uuid and returns it as `x-request-id`. Every log line for the request carries `reqId`, `route` and `method`.
2. The body is checked against `AskRequest` (question up to 1000 characters). A bad body is `400 VALIDATION`. If the embedding model is still warming up, it is `503 EMBEDDINGS_NOT_READY`.
3. A meeting scope, if given, is resolved by uuid or slug. An unknown one is `404`.
4. The question is embedded, then vector and full-text candidates are fetched in parallel and fused. Timings are kept as `embedMs` and `searchMs`.
5. The retrieved chunks are expanded to distinct turns, and each turn is embedded and scored against the question. That extra embedding time is counted in `embedMs`. The refusal rule is then applied to the chunk-level vector scores.
6. A row is inserted in `query_traces` now, with the request id, question, mode and retrieved chunks. A crash later still leaves a row. The API logs `ask.retrieved` (candidate counts, top vector score, whether it was below threshold, timings).
7. The response switches to a stream. `meta` and `sources` are sent.
8. In full mode, the retrieved turns are grouped by meeting, escaped and sent to Sonnet. Tokens are forwarded as `token` events.
9. When the stream ends, the server checks `stop_reason`. `refusal` becomes an `error` event. `max_tokens` keeps the text and logs a warning.
10. The server detects a model refusal, parses `[slug#n]` citations and splits them into valid and dropped.
11. The trace row is updated once: answer, valid citations, dropped citations, model, token counts, `llm_ms`, `total_ms`. The API logs `ask.answered`. The `done` event is sent.
12. On any failure after step 6 the trace gets an `error` and the client gets an `error` event with a generic message. The detail goes to the log only.

The same data is shown two ways:
- The "Why this answer" panel in the UI, fed by the `meta` and `done` events.
- `GET /api/traces/:id`, which returns the stored trace. It still works after a reload, and a reviewer can `curl` it.

Logs are structured JSON from Pino. At `info` level they never contain the API key, transcript text, chunk content, answers or the question. A test fails if they do (`apps/api/test/logging.test.ts`). The question is stored in `query_traces`, which is data in the database, not a log line.
