import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from '../db/pool.js';
import type { Embedder } from '../embed/embedder.js';
import { AppError } from '../errors.js';
import { REFUSAL_TEXT, isModelRefusal, parseCitations, validateCitations } from '../llm/citations.js';
import type { LlmClient } from '../llm/client.js';
import type { PromptMeeting } from '../llm/prompts.js';
import { expandToTurns } from '../retrieval/expand.js';
import { hybridSearch } from '../retrieval/search.js';
import { finishTrace, insertTrace } from '../trace/trace.js';
import { AskEvent, type Mode, type RankedChunk, type SourceTurn } from '../types.js';
import { resolveMeetingIds } from './meetings.js';

export interface AskDeps {
  pool: Pool;
  embedder: Embedder;
  llm: LlmClient;
  retrievalMinScore: number;
  log: FastifyBaseLogger;
}

export interface PreparedAsk {
  traceId: string;
  /** Streams the events. Never throws: failures after this point become an `error` event. */
  run(emit: (event: AskEvent) => void): Promise<void>;
}

/** The refusal rule from spec 4: weak vector evidence and no keyword hit at all. */
export function isBelowThreshold(chunks: RankedChunk[], minScore: number): { topVectorScore: number | null; belowThreshold: boolean } {
  const scores = chunks.flatMap((c) => (c.vectorScore === null ? [] : [c.vectorScore]));
  const topVectorScore = scores.length ? Math.max(...scores) : null;
  const hasTextHit = chunks.some((c) => c.textRank !== null);
  return { topVectorScore, belowThreshold: (topVectorScore === null || topVectorScore < minScore) && !hasTextHit };
}

/**
 * Everything that can fail with a plain JSON error happens here, before the stream opens:
 * scope resolution (404), embedding and retrieval. The trace row exists once this returns.
 */
export async function prepareAsk(
  deps: AskDeps,
  input: { question: string; meetingIds?: string[] | undefined; requestId: string },
): Promise<PreparedAsk> {
  const { pool, embedder, llm, log } = deps;
  const t0 = performance.now();
  const mode: Mode = llm.enabled ? 'full' : 'retrieval-only';
  const meetingIds = input.meetingIds ? await resolveMeetingIds(pool, input.meetingIds) : null;

  const search = await hybridSearch(pool, embedder, { question: input.question, meetingIds });
  const turns = await expandToTurns(pool, search.chunks);
  const { topVectorScore, belowThreshold } = isBelowThreshold(search.chunks, deps.retrievalMinScore);

  const traceId = await insertTrace(pool, {
    requestId: input.requestId,
    question: input.question,
    meetingIds,
    mode,
    retrieval: search.chunks,
    embedMs: search.embedMs,
    searchMs: search.searchMs,
    totalMs: Math.round(performance.now() - t0),
  });
  log.info(
    {
      traceId,
      candidatesVector: search.candidatesVector,
      candidatesText: search.candidatesText,
      fused: search.chunks.length,
      topVectorScore,
      belowThreshold,
      embedMs: search.embedMs,
      searchMs: search.searchMs,
    },
    'ask.retrieved',
  );

  const run = async (rawEmit: (event: AskEvent) => void): Promise<void> => {
    // Every event is checked against the contract before it leaves the API.
    const emit = (event: AskEvent) => rawEmit(AskEvent.parse(event));
    const timings = (llmMs: number | null) => ({
      embedMs: search.embedMs,
      searchMs: search.searchMs,
      llmMs,
      totalMs: Math.round(performance.now() - t0),
    });

    emit({ type: 'meta', traceId, mode, model: llm.answerModel });
    emit({ type: 'sources', chunks: search.chunks, turns });

    try {
      if (belowThreshold) {
        emit({ type: 'refusal', reason: 'below_threshold', topVectorScore });
        const answer = llm.enabled ? REFUSAL_TEXT : null;
        const tm = timings(null);
        await finishTrace(pool, traceId, {
          refused: true, refusalReason: 'below_threshold', answer, totalMs: tm.totalMs,
        });
        log.info({ traceId, model: null, citations: 0, droppedCitations: 0, refusalReason: 'below_threshold', totalMs: tm.totalMs }, 'ask.answered');
        emit({ type: 'done', answer, citations: [], droppedCitations: [], refusalReason: 'below_threshold', usage: null, timings: tm });
        return;
      }

      if (!llm.enabled) {
        const tm = timings(null);
        await finishTrace(pool, traceId, { totalMs: tm.totalMs });
        emit({ type: 'done', answer: null, citations: [], droppedCitations: [], refusalReason: null, usage: null, timings: tm });
        return;
      }

      const l0 = performance.now();
      const result = await llm.streamAnswer({
        meetings: await promptMeetings(pool, turns),
        question: input.question,
        onToken: (text) => emit({ type: 'token', text }),
      });
      const llmMs = Math.round(performance.now() - l0);

      if (result.stopReason === 'refusal') {
        throw new AppError('LLM_ERROR', 'The model declined this request.');
      }
      if (result.stopReason === 'max_tokens') log.warn({ traceId }, 'ask.truncated');

      const refusal = isModelRefusal(result.text);
      const { valid, dropped } = validateCitations(parseCitations(result.text), turns);
      const tm = timings(llmMs);
      await finishTrace(pool, traceId, {
        refused: refusal,
        refusalReason: refusal ? 'model_declined' : null,
        answer: result.text,
        citations: valid,
        droppedCitations: dropped,
        model: llm.answerModel,
        usage: result.usage,
        llmMs,
        totalMs: tm.totalMs,
      });
      log.info(
        {
          traceId,
          model: llm.answerModel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          llmMs,
          totalMs: tm.totalMs,
          citations: valid.length,
          droppedCitations: dropped.length,
          refusalReason: refusal ? 'model_declined' : null,
        },
        'ask.answered',
      );
      emit({
        type: 'done',
        answer: result.text,
        citations: valid,
        droppedCitations: dropped,
        refusalReason: refusal ? 'model_declined' : null,
        usage: result.usage,
        timings: tm,
      });
    } catch (err) {
      // The detail goes to the log; the client only gets a generic message unless we wrote it ourselves.
      const message = err instanceof AppError ? err.message : 'The answer could not be generated.';
      const code = err instanceof AppError ? err.code : 'LLM_ERROR';
      log.error({ traceId, code, message: err instanceof Error ? err.message : String(err) }, 'ask.failed');
      await finishTrace(pool, traceId, { error: message, totalMs: timings(null).totalMs, model: llm.answerModel }).catch(() => undefined);
      try {
        emit({ type: 'error', code, message });
      } catch {
        // the stream is already gone
      }
    }
  };

  return { traceId, run };
}

/** Group the retrieved turns by meeting, with the title the prompt needs. */
async function promptMeetings(pool: Pool, turns: SourceTurn[]): Promise<PromptMeeting[]> {
  const ids = [...new Set(turns.map((t) => t.meetingId))];
  const { rows } = await pool.query<{ id: string; slug: string; title: string }>(
    'SELECT id, slug, title FROM meetings WHERE id = ANY($1::uuid[]) ORDER BY slug',
    [ids],
  );
  return rows.map((m) => ({ slug: m.slug, title: m.title, turns: turns.filter((t) => t.meetingId === m.id) }));
}
