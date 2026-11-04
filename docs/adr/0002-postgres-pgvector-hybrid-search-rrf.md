# ADR-0002: Postgres with pgvector and full-text search, fused with RRF

- Status: accepted
- Date: 2026-11-04

## Context
- Meeting questions need two kinds of match. Meaning ("when did the launch slip?") and exact words (a name, a plan called "Starter", a figure).
- The app already needs a relational store for meetings, turns, extraction results and query traces.
- A reviewer must be able to run everything with one `docker compose up`.

## Options considered
1. Postgres with pgvector for vectors and built-in full-text search for keywords, fused with reciprocal rank fusion (RRF).
2. A dedicated vector database next to Postgres.
3. Vector search only, in Postgres.
4. A weighted sum of the two scores instead of RRF.

## Decision
Option 1.
- `chunks.embedding` is `vector(384)` with an HNSW cosine index. `chunks.tsv` is a generated `tsvector` with a GIN index.
- Each question fetches 20 vector candidates and 20 full-text candidates, fuses them with RRF at k = 60 and keeps the top 8 chunks.
- Ties break on the vector score, then on id, so the order is deterministic.
- The fusion is a pure function in `apps/api/src/retrieval/rrf.ts`, with its own unit tests.

## Consequences
- One database to run, back up and reason about. Meeting scope filters are plain SQL on the same table.
- RRF uses ranks, not scores, so it needs no tuning between cosine similarity and `ts_rank_cd`, which sit on different scales.
- Measured: with the full-text side working, recall over every retrieved turn is 0.849. Lowering k to 20 or 10 gave 0.818, so k stays at 60 (see ADR 0005 and `apps/api/README.md`).
- The HNSW index does not matter at this size. Four transcripts would scan in the same time. It is there to show the production shape.
- Rejected option 2: a second system to deploy and keep in sync, with nothing to gain at this scale.
- Rejected option 3: it misses exact terms. The eval has no run of vector-only retrieval, so the size of that loss is not measured.
- Rejected option 4: it needs weights chosen by hand. A weighted sum was not run on the eval.
- Postgres is not the answer at millions of chunks. The path from here belongs in the productionising section of the README.
