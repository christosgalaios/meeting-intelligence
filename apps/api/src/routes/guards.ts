import { AppError } from '../errors.js';
import type { Embedder } from '../embed/embedder.js';

/** Throws 503 while the embedding model is still loading. Call it after the request is validated, before any work. */
export function requireEmbeddings(embedder: Embedder): void {
  if (!embedder.isReady()) throw new AppError('EMBEDDINGS_NOT_READY', 'The embedding model is still loading. Try again shortly.');
}
