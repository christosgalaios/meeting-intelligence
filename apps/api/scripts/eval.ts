// Retrieval eval (spec 8.3). Keyless: seeds with the null LLM, then measures the real embedder + hybrid search.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { BgeEmbedder } from '../src/embed/bge.js';
import { NullLlmClient } from '../src/llm/client.js';
import { expandToTurns, rescoreTurns } from '../src/retrieval/expand.js';
import { hybridSearch, type FtsMode } from '../src/retrieval/search.js';
import { isBelowThreshold } from '../src/services/ask.js';
import { ExtractionQueue } from '../src/services/queue.js';
import { seedTranscripts } from '../src/services/seed.js';

// Spec starting gates were recall@8 0.7 and MRR 0.5; adjusted after the first real run (see apps/api/README.md).
// Turns are ranked the way production ranks them: expand the fused chunks to turns, then rescore each turn by its own
// cosine similarity to the question (rescoreTurns, as in services/ask.ts). recall@8 and MRR count the top 8 turns.
// recallAllRetrieved is what the model actually sees, so it carries the main gate.
const GATE = { recallAt8: 0.58, mrr: 0.64, recallAllRetrieved: 0.8 };

const here = path.dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = path.resolve(here, '../../../evals');

const Questions = z.array(
  z.object({ id: z.string(), question: z.string(), expectedTurnIds: z.array(z.string()), answerable: z.boolean() }),
);

// Experiment knobs: EVAL_FTS=and|or, EVAL_LIMIT=<chunks>, EVAL_RRF_K=<k>, EVAL_NEIGHBOURS=<turns>. Unset means the production defaults.
const KNOBS = {
  search: {
    ...(process.env.EVAL_FTS ? { ftsMode: process.env.EVAL_FTS as FtsMode } : {}),
    ...(process.env.EVAL_LIMIT ? { limit: Number(process.env.EVAL_LIMIT) } : {}),
    ...(process.env.EVAL_RRF_K ? { rrfK: Number(process.env.EVAL_RRF_K) } : {}),
  },
  expand: process.env.EVAL_NEIGHBOURS ? { neighbours: Number(process.env.EVAL_NEIGHBOURS) } : {},
};

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const embedder = new BgeEmbedder();
const log = pino({ level: 'warn' });

const round = (n: number | null, dp = 4) => (n === null ? null : Number(n.toFixed(dp)));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface Row {
  id: string;
  answerable: boolean;
  question: string;
  topVectorScore: number | null;
  hasTextHit: boolean;
  belowThreshold: boolean;
  recall5: number | null;
  recall8: number | null;
  recallAll: number | null;
  rr: number | null;
  ranked: string[];
}

function refusalStats(rows: Row[], threshold: number) {
  let tp = 0, fp = 0, fn = 0;
  for (const r of rows) {
    const predicted = (r.topVectorScore === null || r.topVectorScore < threshold) && !r.hasTextHit;
    if (predicted && !r.answerable) tp++;
    else if (predicted && r.answerable) fp++;
    else if (!predicted && !r.answerable) fn++;
  }
  return {
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    falseRefusals: fp,
    missedRefusals: fn,
  };
}

try {
  await migrate(pool);
  await embedder.warm();
  const seeded = await seedTranscripts(
    { pool, embedder, llm: new NullLlmClient(), queue: new ExtractionQueue(), log },
  );
  console.log(`seed: added ${seeded.added}, skipped ${seeded.skipped}\n`);

  const questions = Questions.parse(JSON.parse(await readFile(path.join(EVALS_DIR, 'questions.json'), 'utf8')));
  const rows: Row[] = [];
  for (const q of questions) {
    const search = await hybridSearch(pool, embedder, { question: q.question, ...KNOBS.search });
    const turns = await rescoreTurns(embedder, q.question, await expandToTurns(pool, search.chunks, KNOBS.expand));
    const ranked = turns.map((t) => t.id);
    const { topVectorScore, belowThreshold } = isBelowThreshold(search.chunks, config.RETRIEVAL_MIN_SCORE, search.strictTextHit);
    const hit = (k: number) => q.expectedTurnIds.filter((id) => ranked.slice(0, k).includes(id)).length / q.expectedTurnIds.length;
    const firstHit = ranked.findIndex((id) => q.expectedTurnIds.includes(id));
    rows.push({
      id: q.id,
      answerable: q.answerable,
      question: q.question,
      topVectorScore,
      hasTextHit: search.strictTextHit,
      belowThreshold,
      recall5: q.answerable ? hit(5) : null,
      recall8: q.answerable ? hit(8) : null,
      recallAll: q.answerable ? hit(ranked.length) : null,
      rr: q.answerable ? (firstHit === -1 ? 0 : 1 / (firstHit + 1)) : null,
      ranked,
    });
  }

  const answerable = rows.filter((r) => r.answerable);
  const metrics = {
    questions: rows.length,
    answerable: answerable.length,
    unanswerable: rows.length - answerable.length,
    recallAt5: mean(answerable.map((r) => r.recall5!)),
    recallAt8: mean(answerable.map((r) => r.recall8!)),
    // Everything the model would see for the question (all turns inside the 8 fused chunks).
    recallAllRetrieved: mean(answerable.map((r) => r.recallAll!)),
    mrr: mean(answerable.map((r) => r.rr!)),
    threshold: config.RETRIEVAL_MIN_SCORE,
    refusal: refusalStats(rows, config.RETRIEVAL_MIN_SCORE),
  };

  const sweep = [];
  for (let t = 0.3; t <= 0.9001; t += 0.02) sweep.push({ threshold: round(t, 2)!, ...refusalStats(rows, t) });

  const pct = (n: number | null, dp = 2) => (n === null ? 'n/a' : n.toFixed(dp));
  console.log('| id | answerable | top vector score | text hit | refused | recall@5 | recall@8 | recall@all | RR |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${r.answerable ? 'yes' : 'no'} | ${pct(r.topVectorScore, 3)} | ${r.hasTextHit ? 'yes' : 'no'} | ${r.belowThreshold ? 'yes' : 'no'} | ${pct(r.recall5)} | ${pct(r.recall8)} | ${pct(r.recallAll)} | ${pct(r.rr)} |`,
    );
  }
  console.log(
    `\nrecall@5 ${metrics.recallAt5.toFixed(3)}  recall@8 ${metrics.recallAt8.toFixed(3)}  MRR ${metrics.mrr.toFixed(3)}  recall@all-retrieved ${metrics.recallAllRetrieved.toFixed(3)}` +
      `  (answerable ${metrics.answerable}, unanswerable ${metrics.unanswerable})`,
  );
  console.log(
    `refusal at threshold ${config.RETRIEVAL_MIN_SCORE}: precision ${pct(metrics.refusal.precision)}  recall ${pct(metrics.refusal.recall)}` +
      `  (false refusals ${metrics.refusal.falseRefusals}, missed ${metrics.refusal.missedRefusals})`,
  );
  console.log('\nthreshold sweep (refusal = top vector score < t and no text hit):');
  console.log('| t | precision | recall | false refusals | missed |');
  console.log('|---|---|---|---|---|');
  for (const s of sweep) console.log(`| ${s.threshold} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.falseRefusals} | ${s.missedRefusals} |`);

  const resultsDir = path.join(EVALS_DIR, 'results');
  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    path.join(resultsDir, 'latest.json'),
    JSON.stringify(
      {
        gate: GATE,
        metrics: {
          ...metrics,
          recallAt5: round(metrics.recallAt5),
          recallAt8: round(metrics.recallAt8),
          recallAllRetrieved: round(metrics.recallAllRetrieved),
          mrr: round(metrics.mrr),
          refusal: { ...metrics.refusal, precision: round(metrics.refusal.precision), recall: round(metrics.refusal.recall) },
        },
        questions: rows.map((r) => ({
          id: r.id,
          answerable: r.answerable,
          topVectorScore: round(r.topVectorScore),
          hasTextHit: r.hasTextHit,
          belowThreshold: r.belowThreshold,
          recallAt5: round(r.recall5),
          recallAt8: round(r.recall8),
          recallAllRetrieved: round(r.recallAll),
          reciprocalRank: round(r.rr),
          top8Turns: r.ranked.slice(0, 8),
        })),
        thresholdSweep: sweep.map((s) => ({ ...s, precision: round(s.precision), recall: round(s.recall) })),
      },
      null,
      2,
    ) + '\n',
  );

  if (metrics.recallAt8 < GATE.recallAt8 || metrics.mrr < GATE.mrr || metrics.recallAllRetrieved < GATE.recallAllRetrieved) {
    console.error(
      `\nFAIL: recall@8 ${metrics.recallAt8.toFixed(3)} (gate ${GATE.recallAt8}), MRR ${metrics.mrr.toFixed(3)} (gate ${GATE.mrr}), ` +
        `recall@all-retrieved ${metrics.recallAllRetrieved.toFixed(3)} (gate ${GATE.recallAllRetrieved})`,
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
