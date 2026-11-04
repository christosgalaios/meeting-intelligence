import type { ApiError } from './types.js';

export type ErrorCode = ApiError['error']['code'];

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  EMPTY_TRANSCRIPT: 400,
  TOO_LARGE: 413,
  EMBEDDINGS_NOT_READY: 503,
  LLM_ERROR: 502,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
  }
}
