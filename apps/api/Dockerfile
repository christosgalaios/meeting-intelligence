# Build context is the repo root (see docker-compose.yml).

# Voice models (about 190 MB installed). Its own stage so a dependency change does not re-download them; the layer is
# keyed on this RUN text and the checksum file. A changed upstream asset fails `sha256sum -c` and so fails the build.
FROM node:24-slim AS voice-models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
COPY apps/api/voice-models.sha256 .
# "speaker-recongition-models" is the upstream release tag's spelling.
ARG SHERPA=https://github.com/k2-fsa/sherpa-onnx/releases/download
RUN curl -fsSL -O $SHERPA/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 \
 && curl -fsSL -O $SHERPA/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx \
 && curl -fsSL -O $SHERPA/asr-models/sherpa-onnx-whisper-base.en.tar.bz2 \
 && sha256sum -c voice-models.sha256 \
 && tar xjf sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 && tar xjf sherpa-onnx-whisper-base.en.tar.bz2 \
 && mkdir -p /models/voice/sherpa-onnx-pyannote-segmentation-3-0 /models/voice/sherpa-onnx-whisper-base.en \
 && mv wespeaker_en_voxceleb_resnet34.onnx /models/voice/ \
 && mv sherpa-onnx-pyannote-segmentation-3-0/model.onnx /models/voice/sherpa-onnx-pyannote-segmentation-3-0/ \
 && mv sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx sherpa-onnx-whisper-base.en/base.en-tokens.txt /models/voice/sherpa-onnx-whisper-base.en/

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# The lockfile covers every workspace, so npm needs each workspace's package.json even when only api is installed.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api && npm cache clean --force
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
ENV ONNXRUNTIME_NODE_INSTALL=skip
# onnxruntime-node ships binaries for every OS and the browser build is never used on the server, so keep only this
# platform. Same layer as the install: a later layer could not give the space back.
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api --omit=dev && npm cache clean --force \
 && cd node_modules/onnxruntime-node/bin/napi-v6 && rm -rf darwin win32 \
 && for d in linux/*; do [ "$(basename $d)" = "$(node -p process.arch)" ] || rm -rf $d; done \
 && rm -rf /app/node_modules/onnxruntime-web
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/seed apps/api/seed

# The embedding model is baked into the image so the first start needs no network and is deterministic.
ENV HF_HUB_CACHE=/models
WORKDIR /app/apps/api
# The model is downloaded as the runtime user so no chown layer duplicates it.
RUN mkdir /models && chown node:node /models
USER node
RUN node dist/embed/download.js
# Copied after the embedding download so that layer stays cached when only the voice models change.
COPY --from=voice-models --chown=node:node /models/voice /models/voice
ENV VOICE_MODELS_DIR=/models/voice

EXPOSE 3001
CMD ["node", "dist/index.js"]
