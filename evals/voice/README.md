# Voice eval

`clip.wav` is a 95 s, 16 kHz mono 16-bit WAV of three distinct synthetic voices reading a short roadmap meeting.
`truth.json` holds who says what and when. The clip is synthetic text-to-speech, so it contains no real person's voice.

It is the fixture for two checks:

- `npm run voice:eval --workspace apps/api` runs the real worker on the clip and prints speakers found, label
  precision and coverage, word error rate, time per audio minute and peak memory. It needs the models, so it is not
  part of `npm test`. Set `VOICE_MODELS_DIR` to a directory laid out as `apps/api/Dockerfile` lays it out.
- The `compose-smoke` job in CI posts the clip to `/api/transcriptions` through nginx and expects three speakers.

Measured on this clip (node:24-slim, 2 threads, CPU): 13.5 s per audio minute, 570 MB peak memory, word error rate
3.2 %, 3 of 3 speakers. This clip is the easy case: distinct voices. Three similar voices are merged or split by the
diarizer, which is why the web app has a review step.

Only `VOICE_NUM_SPEAKERS`, `VOICE_CLIP`, `VOICE_TRUTH` and `VOICE_THREADS` change the eval run.
