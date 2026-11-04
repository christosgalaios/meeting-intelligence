import type { ApiError } from './types.js';

export type ErrorCode = ApiError['error']['code'];

const STATUS: Record<ErrorCode, number> = {
  // 400: the request itself is malformed. 422: it is well-formed but the content (a transcript or audio file) is unusable.
  VALIDATION: 400,
  UNPROCESSABLE: 422,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  EMBEDDINGS_NOT_READY: 503,
  LLM_ERROR: 502,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** One 400 for a body that failed its zod schema, with every problem named by its path. */
export function validationError(issues: readonly { path: readonly PropertyKey[]; message: string }[]): AppError {
  return new AppError('VALIDATION', issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? STATUS[code];
  }
}
