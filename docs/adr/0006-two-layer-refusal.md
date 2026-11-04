# ADR-0006: Two-layer refusal, a score threshold and the model's own "Not discussed"

- Status: accepted
- Date: 2026-11-04

## Context
- A question about something the meetings never covered should get "not discussed", not a made-up answer.
- The cheapest place to stop is before the model is called. The only signal available there is retrieval scores.
- The eval has 6 unanswerable questions written as near misses (they share vocabulary with the transcripts), plus 16 answerable ones.

## Options considered
1. A cosine threshold on the top vector score only.
2. The model's refusal only, with no threshold.
3. Both: a threshold before the call, and a refusal instruction in the prompt.
4. A second model call to judge whether the excerpts answer the question.

## Decision
Option 3.
- Layer 1, in `apps/api/src/services/ask.ts`: refuse when the top vector score is below `RETRIEVAL_MIN_SCORE` (0.58) and no retrieved chunk contains every term of the question. No model call is made.
- Layer 2: the system prompt says to reply with exactly `Not discussed in these meetings.` when the excerpts do not contain the answer. The server matches that string (trimmed, case-insensitive prefix) and records `refusal_reason = 'model_declined'`.
- In retrieval-only mode only layer 1 exists, and the answer stays `null`.

## Consequences
- The threshold is a weak filter. At 0.58 it has precision 1.00 and recall 0.17: it refused 1 of 6 unanswerable questions (q19) and 0 answerable ones. The other 5 got through.
- Score ranges overlap almost completely. Answerable questions top out between 0.582 and 0.828. Unanswerable ones between 0.576 and 0.746. No threshold separates them.
- 0.58 is the highest value that refuses no answerable question. 0.60 already refuses q12 wrongly. The margin to q12 is 0.002, so treat the number as a conservative pre-filter, not a classifier.
- In full mode the model does most of the refusing. I have not measured how often it declines correctly. [TODO: run the 6 unanswerable questions through Sonnet with the dev key and record how many it refuses]
- In retrieval-only mode, a user can still see near-miss turns for an unanswerable question. The UI labels them as the nearest moments, with their scores.
- The text override needs every term of the question in one chunk. With the OR query (ADR 0005) one common word would otherwise defeat the threshold. No eval question has a full match, so the override never fires on this set.
- Rejected option 1 alone: with recall at 0.17 it would let five of six near misses reach the model, and in full mode there would be nothing behind it.
- Rejected option 2 alone: it pays for a model call on every unanswerable question, and gives retrieval-only mode no refusal at all.
- Rejected option 4: a second paid call per question. Not worth it before the first layer's real rate is known.
- Source: `evals/results/latest.json` and `apps/api/README.md`.
