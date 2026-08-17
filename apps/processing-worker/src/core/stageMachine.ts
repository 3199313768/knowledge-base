export type ActiveProcessingStage =
  | 'validate'
  | 'extract'
  | 'chunk'
  | 'embed'
  | 'finalize';

const successorByStage: Record<
  ActiveProcessingStage,
  ActiveProcessingStage | null
> = {
  validate: 'extract',
  extract: 'chunk',
  chunk: 'embed',
  embed: 'finalize',
  finalize: null
};

export function nextStage(
  stage: ActiveProcessingStage
): ActiveProcessingStage | null {
  return successorByStage[stage];
}

export function assertStageTransition(
  from: ActiveProcessingStage,
  to: ActiveProcessingStage
): void {
  if (nextStage(from) !== to) {
    throw new Error(`invalid processing stage transition: ${from} -> ${to}`);
  }
}

export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) {
    throw new Error('attempt must be an integer between 1 and 3');
  }

  if (attempt === 1) return 30_000;
  if (attempt === 2) return 120_000;
  return null;
}
