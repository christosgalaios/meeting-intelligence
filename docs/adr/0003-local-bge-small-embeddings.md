# ADR-0003: Local bge-small embeddings

- Status: accepted
- Date: 2026-11-04

## Context
- Retrieval must work with no API key (ADR 0001), so embeddings cannot depend on a paid service.
- A reviewer should need at most one key: the Claude key for answers.
- Embedding runs on every upload and on every question.

## Options considered
1. A local model, `Xenova/bge-small-en-v1.5`, run in the API process with `@huggingface/transformers`.
2. A hosted embeddings API.
3. A larger local model.

## Decision
Option 1.
- 384 dimensions, CLS pooling, normalised, so cosine distance is exact.
- Questions are embedded with the bge query prefix `Represent this sentence for searching relevant passages: `. Passages are embedded without it.
- Texts are embedded in batches of 16.
- The model is downloaded when the Docker image is built (`node dist/embed/download.js`) and loaded once at boot. `/api/health` reports `embeddings.ready: false` until a warm-up embed has finished, and compose waits for that.

## Consequences
- Retrieval is real and free in both modes. CI runs the eval with the real model and no key.
- The first `docker compose up` needs no network at runtime and behaves the same every time.
- The model is baked in, so the image is larger and the first build is slower. Removing unused onnxruntime binaries took the API image from 2.1 GB to 734 MB. The voice models added later (ADR 0011) bring `docker images` to about 1.1 GB.
- Embedding is CPU work inside the API process. Uploads are embedded synchronously, so a large transcript blocks that request. See the productionising section.
- Quality limit: cosine scores sit in a narrow band. In the eval, answerable questions score 0.582 to 0.828 and unanswerable ones 0.576 to 0.746, so a score alone cannot tell them apart (ADR 0006).
- Rejected option 2: it adds a second key, a cost per upload and per question, and a network call on the path of every search. A reviewer without that key would lose retrieval entirely.
- Rejected option 3: more CPU and a bigger image. The eval was only run with bge-small, so there is no measured case that a larger model would do better here.
