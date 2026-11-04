import { ApiClientError } from '../api/client';

/** The messages the API sends for these are for developers; users get the friendly version. */
export function friendly(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case 'TOO_LARGE':
        return 'That transcript is over 2 MB. Split it into smaller files.';
      case 'EMBEDDINGS_NOT_READY':
        return 'The embedding model is still loading. Try again in a moment.';
      case 'NETWORK':
        return 'Could not reach the API. Is it running?';
      default:
        return err.message;
    }
  }
  return 'Something went wrong while uploading.';
}
