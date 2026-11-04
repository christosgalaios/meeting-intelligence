# ADR-0007: Turn-level citations, validated on the server

- Status: accepted
- Date: 2026-11-04

## Context
- The point of the product is an answer you can check. Each claim should lead to the moment someone said it.
- A model can cite something that was never in its context. A citation shown without a check looks like evidence and is not.
- The UI needs a speaker and a timestamp for every citation, and a way to scroll to the turn.

## Options considered
1. The model writes `[slug#n]` in the answer text. The server parses them and checks each id against the turns it retrieved.
2. The model returns structured JSON with the answer and a list of citations.
3. Cite whole chunks, not turns.
4. No citations, with a list of sources under the answer.

## Decision
Option 1, in `apps/api/src/llm/citations.ts`.
- Every turn has an id, `<meeting slug>#<n>`, which is the same id in the prompt, the database and the UI anchor.
- The prompt asks for `[id]` straight after each sentence it supports, and only ids that appear in the excerpts.
- The server matches `/\[([a-z0-9-]+#\d+)\]/g`, de-duplicates in order of appearance, and splits the result.
  - Valid: the id is one of the retrieved turns. It becomes a citation with speaker and timestamp, read from the database.
  - Dropped: the id was not retrieved. It is recorded in `dropped_citations` on the trace and shown in "why this answer".
- The answer text is not rewritten. The web app only renders a citation chip for a valid id. A dropped id stays as plain text.
- Extraction works the same way: an unknown `turnId` is stored as null. The item is kept, the link is not.

## Consequences
- A reviewer can click a chip and land on the exact turn. A made-up id cannot look like a source.
- Streaming stays simple, because the answer is plain text and tokens go straight to the client.
- The check proves the model cited a turn it was given. It does not prove that turn supports the claim. That would need a faithfulness check, which is not built. See the productionising section.
- A model that forgets to cite produces an answer with no chips. The UI shows no warning for that today.
- Rejected option 2: structured output cannot be streamed token by token in the same way, and it moves the citation problem into JSON without removing it.
- Rejected option 3: a chunk is up to 6 turns. A citation should name one speaker at one time.
- Rejected option 4: the user could not tell which sentence came from which source.
- Tests: `apps/api/test/citations.test.ts`, and the API tests with a fake model that cites one valid and one invalid id.
