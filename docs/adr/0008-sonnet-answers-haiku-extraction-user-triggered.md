# ADR-0008: Sonnet for answers, Haiku for extraction, every paid call user-triggered

- Status: accepted
- Date: 2026-11-04

## Context
- Two jobs need a model. Answering a question over several meetings (reasoning across excerpts, with citations) and pulling decisions and action items out of one transcript (structured output, long input).
- Reviewers will run this with their own key. Nothing should spend their money without them asking.
- I use a dev key for development, the eval, screenshots and the video. The Anthropic account it belongs to has a spend limit of $1, and holds no other live API keys.

## Options considered
1. `claude-sonnet-5-5` for answers, `claude-haiku-5-5` for extraction.
2. Haiku for both.
3. Sonnet for both.
4. A larger model for answers.

## Decision
Option 1.
- Answers: Sonnet, streamed, `max_tokens` 1024, effort `low`. The system prompt is constant and carries `cache_control`, so it can be cached.
- Extraction: Haiku, one non-streaming call per transcript, structured output checked against a zod schema, `max_tokens` 4096, effort `low`. Over 60,000 words it is not attempted, and the meeting is marked failed with the message `transcript too long for extraction`.
- No temperature, top_p, prefill or forced tools. Those are rejected by these models.
- Prices on record in the spec: Sonnet $2 per million input tokens and $10 per million output. Haiku $0.10 and $0.50.
- A real answer in the screenshots used 3,128 input and 519 output tokens, which is $0.0114 at those prices.

Paid calls happen only on a user action:
- Asking a question, with the cost estimate shown on the button.
- Uploading a transcript with a key set, which starts extraction for that file.
- Pressing the extract button on a sample meeting. Seeding never calls a model, even with a key set.
- CI and tests use a fake model. The eval is keyless.

## Consequences
- Extraction is cheap, which suits a call that reads a whole transcript.
- The ask estimate on the button is an assumption (about 4,000 input and 300 output tokens), not a measurement. The real figure replaces it once the answer finishes.
- Without a key the model layer is a null client that nothing calls. The mode is fixed at start from `ANTHROPIC_API_KEY`.
- I did not run Haiku against Sonnet on answer quality, so "Sonnet for answers" is a judgement, not a result. There is no faithfulness eval, and no Haiku-against-Sonnet comparison was run. Both are on the "with more time" list. The only live check is a small manual run of refusals and one injection question (ADR 0006 and ADR 0009).
- Rejected option 2: answers synthesise across meetings and must follow the citation rules, which is where a smaller model is most likely to slip. Not measured.
- Rejected option 3: it spends Sonnet prices on a task Haiku can do with structured output.
- Rejected option 4: higher cost per question, and I had no result showing Sonnet was not good enough.
