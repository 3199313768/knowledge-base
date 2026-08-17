import type {
  ChunkDraft,
  EmbeddingProvider as SharedEmbeddingProvider,
  NormalizedBlock,
  ProcessingErrorCode,
  ProcessingSourceLocation,
  ProcessingWarning
} from '@knowledge-base/contracts';

import type { ArtifactKind } from '../artifacts/codec';
import type { ExtractionResult, Extractor } from '../extractors/registry';
import type { ActiveProcessingStage } from './stageMachine';

export interface OriginalDescriptor {
  storagePath: string;
  mimeType: string;
  checksum: string;
  sizeBytes: number;
}

export interface ClaimedJob {
  jobId: string;
  versionId: string;
  fileId: string;
  workspaceId: string;
  stage: ActiveProcessingStage;
  attempt: number;
  leaseExpiresAt: Date;
  original: OriginalDescriptor;
}

export interface FailureReport {
  code: ProcessingErrorCode;
  retryable: boolean;
}

export interface TerminalVersion {
  workspaceId: string;
  versionId: string;
  status: 'searchable' | 'partially_searchable' | 'failed';
  terminalAt: Date;
}

export interface ProcessingRepository {
  claim(
    workerId: string,
    leaseSeconds: number,
    signal: AbortSignal
  ): Promise<ClaimedJob | null>;
  heartbeat(
    job: ClaimedJob,
    workerId: string,
    leaseSeconds: number,
    signal: AbortSignal
  ): Promise<Date>;
  completeStage(
    job: ClaimedJob,
    nextStage: ActiveProcessingStage,
    signal: AbortSignal
  ): Promise<void>;
  failStage(
    job: ClaimedJob,
    failure: FailureReport,
    signal: AbortSignal
  ): Promise<void>;
  recordWarning(
    job: ClaimedJob,
    warning: ProcessingWarning,
    signal: AbortSignal
  ): Promise<void>;
  finalizeVersion(
    job: ClaimedJob,
    status: 'searchable' | 'partially_searchable',
    errorCode: ProcessingErrorCode | null,
    signal: AbortSignal
  ): Promise<void>;
  countWarnings(versionId: string, signal: AbortSignal): Promise<number>;
  listTerminalVersions(
    olderThan: Date,
    limit: number,
    signal: AbortSignal
  ): Promise<TerminalVersion[]>;
}

export interface OriginalStore {
  download(
    original: OriginalDescriptor,
    destinationPath: string,
    signal: AbortSignal
  ): Promise<void>;
}

export interface ArtifactStore {
  read(
    workspaceId: string,
    versionId: string,
    kind: ArtifactKind,
    signal: AbortSignal
  ): Promise<Uint8Array>;
  write(
    workspaceId: string,
    versionId: string,
    kind: ArtifactKind,
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<void>;
  deleteVersion(
    workspaceId: string,
    versionId: string,
    signal: AbortSignal
  ): Promise<void>;
}

export interface EmbeddedChunk {
  index: number;
  content: string;
  sourceLocation: ProcessingSourceLocation;
  embedding: readonly number[];
}

export interface ChunkRepository {
  replaceUnpublished(
    job: ClaimedJob,
    chunks: readonly EmbeddedChunk[],
    signal: AbortSignal
  ): Promise<void>;
}

export interface ExtractorRegistry {
  get(kind: Extractor['kind']): Extractor | undefined;
}

export interface EmbeddingProvider extends SharedEmbeddingProvider {}

export interface Clock {
  now(): Date;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  repeat(task: () => Promise<void>, milliseconds: number): () => void;
  after(task: () => void, milliseconds: number): () => void;
}

export interface Logger {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
  error(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export interface LeaseGuard {
  readonly signal: AbortSignal;
  assertLease(): void;
}

export type StageHandler = (
  job: ClaimedJob,
  context: LeaseGuard
) => Promise<void>;

export type StageHandlers = Record<ActiveProcessingStage, StageHandler>;

export interface RunnerDependencies {
  repository: ProcessingRepository;
  artifactStore: ArtifactStore;
  handlers: StageHandlers;
  clock: Clock;
  logger: Logger;
  leaseSeconds: number;
  heartbeatMs: number;
  jobTimeoutMs: number;
}

export interface StageDependencies {
  repository: ProcessingRepository;
  originalStore: OriginalStore;
  artifactStore: ArtifactStore;
  chunkRepository: ChunkRepository;
  extractorRegistry: ExtractorRegistry;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
}

export type { ChunkDraft, ExtractionResult, NormalizedBlock };
