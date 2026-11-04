# ADR-0004: Chunk by speaker turn, 6 turns or 180 words, overlap of 2

- Status: accepted
- Date: 2026-11-04

## Context
- A transcript is a list of turns: a timestamp, a speaker and what they said.
- Meeting questions are usually about who said what ("what did Declan agree to?") and when.
- The embedding model reads at most 512 tokens, and short chunks keep a hit specific.

## Options considered
1. Windows of whole speaker turns, capped by turn count and word count, with overlap.
2. Fixed-size token windows over the raw text.
3. One chunk per turn.
4. Topic segments found by a model.

## Decision
Option 1, in `apps/api/src/transcript/chunk.ts`.
- A window takes up to 6 whole turns. It stops earlier if the next turn would take it past 180 words.
- A single turn longer than 180 words is its own chunk. The embedder truncates it; it is not split.
- The next window starts 2 turns before the end of the last one, and always moves forward.
- The embedded text is `Speaker: text` per turn. Timestamps and ids are left out because they are noise for the embedder and for full-text search. They come back from the `turns` table at query time.

## Consequences
- Speaker attribution is never cut in half. A chunk always starts and ends on a turn boundary.
- The 2-turn overlap keeps a question and its answer together in at least one chunk when they straddle a boundary.
- The model is shown whole turns, and every turn has an id (`slug#n`) that can be cited (ADR 0007).
- Rejected option 2: it cuts through the middle of a turn and loses who is speaking.
- Rejected option 3: a turn like "Okay." or "Noted." embeds to almost nothing, and the answer to a question often sits in the turn before it.
- Rejected option 4: it costs a model call per upload and breaks the rule that retrieval works with no key.
- The numbers 6, 180 and 2 are reasoned, not tuned. The eval did not compare other chunk sizes. Adding neighbouring turns was tried and rejected (see `apps/api/README.md`).
- The eval's recall@5 and recall@8 count turns, and 8 turns is only one or two chunks, so those two numbers are coarse. They come from 16 answerable questions.
