# ADR-0001: No key means retrieval-only mode; full answers need your own Claude key

- Status: accepted (draft wording, to be rewritten by Christos)
- Date: 2026-11-04

## Context
- Reviewers need to run the app from a clean clone.
- Not every reviewer has an Anthropic key, or wants to paste one in.
- A hosted demo would put my key behind a public URL.

## Options considered
1. Require a key to run at all.
2. Canned mock answers when no key is set.
3. Retrieval-only mode when no key is set; full answers with the reviewer's own key.
4. Hosted demo on my key.

## Decision
Option 3. Embeddings run locally, so retrieval is real and free. Without a key the app returns the top-ranked speaker turns with timestamps, clearly labelled as retrieval-only. With a key it adds generated answers with citations and extracts decisions and action items.

## Consequences
- The app works end to end on a clean clone with zero setup cost.
- Without a key, a reviewer sees real retrieval quality, not a fake.
- Extraction (decisions, action items) only appears with a key. An uploaded transcript is extracted automatically; the sample meetings are not, and each shows an extract button with a cost estimate.
- Canned responses exist only as test fixtures, so CI needs no key.
