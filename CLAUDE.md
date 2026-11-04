# Rules for AI coding agents in this repo

These rules apply to any AI agent (Claude Code or other) working in this repository.

## Project
Meeting Intelligence: a TypeScript RAG app over meeting transcripts.
- `apps/api`: Fastify backend. Owns the database, embeddings, retrieval and every LLM call.
- `apps/web`: React + Vite frontend. Talks only to `apps/api`.

## Hard rules
- The Anthropic key lives only in the API process environment. Never in `apps/web`, never in a `VITE_*` variable, never in a log line.
- With no key set, the app runs in retrieval-only mode. Never return invented or canned answers outside tests.
- Normalise and validate every LLM response in the API (zod) before it reaches the frontend.
- No LLM call runs automatically from the UI without a user action.
- Every bug fix ships with a test that fails without the fix.
- No date literals near "today" in tests. Freeze the clock instead.
- Never commit `.env`. Stage files by name, never `git add -A`.
- Keep changes scoped to the task. No drive-by refactors.

## Before saying a task is done
1. `npm test` passes, and the output is shown.
2. The diff has been read in full.
3. For behaviour changes: run the app and observe the change.

## Style
- TypeScript strict mode. No `any` without a comment saying why.
- Colours come from design tokens, never hardcoded.
- Comments explain why, not what.
