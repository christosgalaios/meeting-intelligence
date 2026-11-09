# How AI tools were used

README section g is the summary. This page has the detail behind it: how the work was split, the rules every agent followed, and a log of what the reviews and checks caught.

## The setup

Claude Code was the only coding tool. The work was split by role and model:

| Role | Model | What it did |
|---|---|---|
| Planner | Fable | Wrote `docs/spec.md` from the brief and my constraints: the API contract, the schema, the retrieval design and the task list. It wrote no code. |
| Builders | Sonnet | Built the backend, the frontend, the voice feature and the review fixes, each to the spec or a written plan. |
| Orchestrator | Opus | Handed out the work, checked each result against its acceptance criteria and sent work back. It never accepted a builder's own "done". |
| Reviewer | Opus | Reviewed the plan before building and the code afterwards. It was given the brief but not my conclusions. |

The design was made in Claude Design from a written brief (`docs/design/brief.md`). The exported designs are in `docs/design/`.

Every change went through a branch and a pull request, with CI green before merging. The history is in the repo's pull requests.

## The rules

`CLAUDE.md` holds the rules every agent read at the start of every task. The ones that mattered most:

- The API key lives only in the API process. It never reaches the web app or a log line.
- With no key, the app runs in retrieval-only mode. No canned answers outside tests.
- Every model response is validated with zod before it reaches the frontend.
- No model call runs without a user action.
- Every bug fix ships with a test that fails without the fix.
- Before saying a task is done: show the test output, read the whole diff, and run the app for behaviour changes.

gitleaks scans every commit for secrets, both before the commit and in CI.

## What the reviews and checks caught

Each row is a case where an agent's output was wrong or not what I wanted, and who caught it.

| When | What the agent produced | What changed | Who caught it |
|---|---|---|---|
| Plan | Canned mock answers as the default when there is no key | Retrieval-only mode, so a reviewer without a key still gets real results on their own transcripts | A reviewer agent flagged it; I approved the change |
| Plan | A seven-day build with OpenTelemetry, Playwright, WebVTT and speaker filters | Capped at two days, with the rest on the "with more time" list | Me |
| Plan | Running answers through my Claude subscription instead of an API key | Rejected. I decided to build it like a proper product, with the reviewer's own key | Me |
| Backend (PR #1) | The agent went idle "waiting for the rebuilt image" | No build was running, the Docker build had failed and one test was red. Sent back to fix in the foreground | The orchestrator, by checking the artefacts |
| Backend (PR #1) | "Done", with tests and CI green | 14 issues CI could not see, including CORS open to any origin (any web page could spend the key), the model stream not stopped when the browser disconnects, a 2.1 GB image from unused GPU binaries, order-dependent tests and a lint step that did nothing. All fixed | An independent Opus review of the diff |
| Backend (PR #1) | Retrieval accepted as built | The full-text query required every word, so natural questions almost never matched. Switched to matching any word, measured with the eval set frozen (ADR 0005) | The orchestrator, by running the eval |
| Frontend (PR #2) | "Done" | Seeding with a key set made four paid extraction calls, which broke the rule that every paid call needs a click. Seeding now never calls a model | The orchestrator |
| Decision walkthrough | A file with one valid line and a lot of junk was accepted, embedded and sent to extraction | A validation step before anything is parsed, embedded or sent to a model (PR #3) | Me, when I asked whether input was validated |
| Voice (PR #6) | "Done" | The upload limit was checked after the file was read, and imports gave no cost hint. Sent back once; both fixed | The orchestrator |
| Cold review (PR #7) | The eval ranked turns differently from the app | The eval now uses the app's own ranking. recall@8 went from 0.44 to 0.60, and the CI gates were raised to match | An Opus reviewer, on a review I asked for against the brief |
| Docs (PR #9, #11) | Docs said "I ran" or "I checked" for checks the orchestrator ran | Reworded so each check says who did it | The orchestrator, on a re-read |

## The decision walkthrough

During the build, Claude put 12 build decisions in front of me with their trade-offs. I kept all 12 and raised one question, about input validation, which became the fix in the table above. The 12:

1. Postgres with pgvector
2. Local bge-small embeddings
3. Chunking by speaker turns
4. A full-text query that matches any word
5. Refusal in two layers
6. Dropping citations that were not retrieved
7. Sonnet for answers
8. Extraction on upload or on a button
9. Wrapping transcripts as untrusted input
10. A retrieval-only eval in CI
11. A localhost-only, same-origin network
12. The cut list as planned

## Do's and don'ts

- Do give an agent a spec with acceptance checks. Don't accept "done" from the agent that did the work.
- Do check artefacts, not reports. Most of the catches above came from running the thing.
- Do get reviews from a model that has not seen the author's reasoning.
- Do keep the rules in a file the agents read every time, rather than repeating them in chat.
- Don't let an agent decide anything that spends money, exposes a key or changes who can reach the app.
