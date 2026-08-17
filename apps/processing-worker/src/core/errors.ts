import type { ProcessingErrorCode } from '@knowledge-base/contracts';

export class ProcessingFailure extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ProcessingErrorCode,
    message: string,
    retryable: boolean
  ) {
    super(message);
    this.name = 'ProcessingFailure';
    this.retryable = retryable;
  }
}
