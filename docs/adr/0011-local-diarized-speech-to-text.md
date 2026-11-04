# ADR-0011: Local diarized speech-to-text

- Status: accepted
- Date: 2026-11-04

## Context
- Transcripts are the input to everything, but people have recordings, not transcripts.
- The app must stay keyless and local (ADR 0001, ADR 0003). A cloud speech API would need a key and would send the audio to a third party.
- A browser can decode almost any audio format. The API image should not carry ffmpeg for that.
- The transcript format needs who spoke, so plain speech-to-text is not enough. It needs diarization.

## Options considered
1. sherpa-onnx in a worker thread of the API: pyannote segmentation 3.0, wespeaker resnet34 speaker embeddings, Whisper base.en int8. The browser decodes to 16 kHz mono WAV.
2. ffmpeg in the API image to decode, then the same models.
3. transformers.js Whisper with no diarization.
4. A cloud speech-to-text API.
5. Store audio or drafts in Postgres and process in a separate container.

## Decision
Option 1.
- The browser decodes any playable audio to 16 kHz mono 16-bit WAV (`OfflineAudioContext`) and refuses recordings over 30 minutes before uploading.
- `POST /api/transcriptions` accepts only that WAV and answers 202. The job runs in a `worker_threads` worker inside the API process, one at a time, through an in-memory queue capped at 4 active jobs. `GET /api/transcriptions/:id` is polled.
- The draft (segments and a rendered transcript) goes through the existing `POST /api/meetings` only when the user clicks Import in the review step. The user can rename and merge speakers, and re-run with a chosen speaker count.
- The models are downloaded in their own Docker stage, checked against committed SHA-256 sums, and baked into the image. Voice is on only when `VOICE_MODELS_DIR` holds the five model files; `/api/health` reports `voice.available`.
- `sherpa-onnx-node` is imported only in `src/voice/worker.ts`, so tests and the type check never load the native module.

## Measured
Spike in node:24-slim, linux/amd64, CPU, 2 threads, a 95 second clip of three distinct synthetic voices:

| Setup | Time per audio minute | Peak memory | Speakers found | Word error rate |
|---|---|---|---|---|
| wespeaker + Whisper base.en int8 | 13.5 s | 570 MB | 3 of 3 | 3.2% |
| wespeaker + Whisper tiny.en int8 | 11.7 s | 425 MB | 3 of 3 | 5.1% |
| titanet small embeddings | not recorded | not recorded | 4 | over-split |
| 3dspeaker campplus embeddings | not recorded | not recorded | 6 | 50% label accuracy |
| transformers.js Whisper | about 20 s | 1.8 GB | no diarization | worse |

On three similar female voices, wespeaker returned 1 speaker at threshold 0.5 and 0.6, 2 at 0.4 and 0.3, and 4 at 0.2. Setting the speaker count to 3 still returned 2, which I did not diagnose. Diarization is reliable for distinct voices and unreliable for similar ones, so the review step is part of the design, not a polish item.

Re-measured through the shipped worker in the compose stack: 14.8 s diarizing plus 7.2 s transcribing for the 95 second clip (22 s, 13.9 s per audio minute), and 3 of 3 speakers. Image filesystem: 509 MiB before, 725 MiB after.

## Consequences
- The API image grows by about 216 MiB: 32 MB for the sherpa-onnx native package and about 185 MB of models.
- A 30 minute cap. Memory is measured only to 95 seconds, and the float32 samples alone are 115 MB at 30 minutes, so longer audio is refused rather than attempted. The cap is a number I chose from that slope, not a measured limit.
- Jobs live in memory. An API restart loses queued and running jobs, and the browser gets a 404 and offers a retry. This is deliberate: the audio is never stored and a draft is thrown away unless the user imports it, so there is nothing durable to keep. If the API ever runs as more than one replica, or a job outlives a deploy, this needs a table.
- English only (Whisper base.en).
- One job at a time. A queued job holds its samples in memory, at most about 58 MB each, which is why the queue is capped at 4.
- A native out-of-memory kill takes the whole API process, not just the worker. Compose sets `mem_limit: 2g` as a backstop; nothing here catches it.
- Anyone with a job id can read its draft. This is the same trust model as the rest of the app: no login, loopback only.
- `Health` gains one additive field, `voice`. The contract note is in `docs/spec.md` section 5.1.

## Alternatives rejected
- ffmpeg in the image: adds about 647 MB, and the browser can already decode.
- transformers.js Whisper: slower, 1.8 GB of memory, worse word error rate, and no diarization.
- Cloud speech-to-text: needs a key and sends the audio away, against ADR 0001.
- Storing audio or drafts in Postgres: nothing to keep, and a liability for no feature.
- A separate container: one more process to health-check in a localhost app.
