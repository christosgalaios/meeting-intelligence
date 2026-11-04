export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5' as const;
export const EMBEDDING_DIM = 384;

// bge v1.5 expects this prefix on queries only; passages are embedded as-is.
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  /** False until the model is loaded and a warm-up embed has finished. */
  isReady(): boolean;
}

/** pgvector text input format. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
