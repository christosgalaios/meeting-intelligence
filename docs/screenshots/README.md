# Screenshots

All screenshots, taken from the running app. The full-mode shots use `claude-sonnet-5-5` with the four sample meetings loaded.

![The library: four meetings, an ask box with a cost hint, and an upload area that takes a .txt file, pasted text or audio, with a note that importing also runs a paid extraction](01-library.png)

**Library.** Meeting cards show the date, length, speakers, and decision and action counts once a meeting has been extracted.

![An answer to a question across all four meetings, with citation chips that show a timestamp and a speaker, and the transcript on the right highlighting the first cited turn](02-ask-cited-answer.png)

**Ask, full mode.** Every claim ends in a chip with the time and speaker. Clicking one scrolls the transcript to that turn and highlights it. Only citations that the server checked against the retrieved turns become chips.

![The Why this answer panel: token counts, latency by stage, estimated cost, and the retrieved chunks with vector and full-text scores, each marked cited or not cited](03-why-this-answer.png)

**Why this answer.** Tokens, latency per stage, an estimated cost, and every retrieved chunk with its vector and full-text rank and score. Each chunk is marked cited or not cited.

![Retrieval-only mode: a banner says the server has no Anthropic key, and the result is a ranked list of speaker turns with scores](04-retrieval-only.png)

**Retrieval-only mode (no key).** Same retrieval, no generated answer. The result is the best-matching speaker turns with timestamps, and the banner says why.

![A question about something not in the meetings gets the message Not discussed in these meetings, with the nearest moments listed underneath](05-refusal.png)

**Refusal.** A question about something the meetings never covered. The top vector score was below the threshold, so no model call was made. The nearest moments are still shown.

![The Pricing kickoff meeting page after extraction: five decisions and seven action items with owner, due wording and source time, and a talk-time bar](06-meeting-detail-extraction.png)

**Meeting page.** Decisions and action items extracted by Claude Haiku when the user asks, each linked to the turn it came from. Talk time is computed from the transcript and uses no model.

![A 95-second recording transcribed on the server: three speakers found and labelled Speaker 1 to 3, with the draft transcript below](07-voice-transcribed.png)

**Audio, transcribed.** Speaker detection and Whisper run on the API's own CPU, with no key and no cost. The test clip is three synthetic voices (`evals/voice/clip.wav`).

![Reviewing the transcribed recording: the three speakers renamed, merge and re-run controls in one row, and the draft transcript below. Nothing is saved until Import](08-voice-review.png)

**Review before import.** A person names the speakers, merges any that were split, or re-runs with a set speaker count. Nothing is saved until Import, and the audio is never stored.

![A question about the imported recording, answered with citation chips that point at the transcribed turns](09-voice-answer.png)

**Asking about a recorded meeting.** Once imported it is chunked, embedded and cited like any other transcript.

![The empty library before any meeting is added, with an option to load the sample meetings](10-empty-library.png)

**Empty state.** Taken with the meeting list request answered empty in the browser, since the stack seeds the samples on start.

![The Launch readiness meeting page in the dark theme](11-dark-theme.png)

**Dark theme.**
