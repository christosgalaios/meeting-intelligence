# Evals

Three checks on whether the app finds and says the right things.

## Retrieval eval (runs in CI)

`questions.json` holds 22 hand-labelled questions about the four sample meetings: 16 that the meetings answer and 6 that they deliberately don't. Each one lists the speaker turns that hold the answer (`expectedTurnIds`, as `meeting-slug#turn`):

```json
{ "id": "q01", "question": "What price was agreed for the Starter plan, and how many seats does it allow?",
  "expectedTurnIds": ["2026-10-06-pricing-kickoff#29"], "answerable": true }
```

`npm run eval` seeds the database, embeds each question with the real model, and ranks turns exactly as the app does. It needs no API key. It reports:

- **recall@5 and recall@8:** of the expected turns, the share found in the top 5 or top 8.
- **MRR:** where the first expected turn appears, as 1 / its position, averaged over the questions.
- **All-retrieved recall:** the share of expected turns anywhere in what the model is shown.
- **Refusal:** for each threshold, how many unanswerable questions would be refused and how many answerable ones wrongly refused.

Results are written to `results/latest.json`. CI fails if recall@8 drops below 0.58, MRR below 0.64 or all-retrieved recall below 0.80. Those gates were set just under the measured values (recall@8 0.604, MRR 0.667, all-retrieved recall 0.849).

Sixteen answerable questions is a small set: one turn moves a metric by 0.02 to 0.06. Treat the numbers as coarse.

## Manual refusal and injection check (one run, with a key)

`results/manual-refusal-and-injection-2026-11-04.jsonl` is the raw output of one live run through the full app on 2026-11-04. It covers the 6 unanswerable questions and one question that lands on the planted "ignore all previous instructions" line in a sample transcript. All 6 were refused (1 by the threshold, 5 by the model), and the injection line was quoted, not followed. It is one run, so it is indicative, not a measured rate.

## Voice eval

`voice/` holds a 95-second synthetic clip and its ground truth. See [`voice/README.md`](voice/README.md).
