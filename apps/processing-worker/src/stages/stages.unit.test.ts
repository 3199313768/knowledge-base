import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { decodeArtifact, encodeArtifact } from '../artifacts/codec';
import type {
  ArtifactStore,
  ClaimedJob,
  LeaseGuard,
  ProcessingRepository
} from '../core/ports';
import { createChunkStage } from './chunkStage';
import { createCleanupStage } from './cleanupStage';
import { createEmbedStage } from './embedStage';
import { createExtractStage } from './extractStage';
import { createFinalizeStage } from './finalizeStage';
import { createValidateStage } from './validateStage';

const pdfBytes = Buffer.from('%PDF-1.4\nsynthetic\n', 'utf8');
const checksum = `sha256:${createHash('sha256').update(pdfBytes).digest('hex')}`;
const baseJob: ClaimedJob = {
  jobId: '10000000-0000-4000-8000-000000000001',
  versionId: '20000000-0000-4000-8000-000000000002',
  fileId: '30000000-0000-4000-8000-000000000003',
  workspaceId: '40000000-0000-4000-8000-000000000004',
  stage: 'validate',
  attempt: 1,
  leaseExpiresAt: new Date('2026-08-10T10:00:00.000Z'),
  original: {
    storagePath: 'workspace/version/original.pdf',
    mimeType: 'application/pdf',
    checksum,
    sizeBytes: pdfBytes.byteLength
  }
};
const guard: LeaseGuard = {
  signal: new AbortController().signal,
  assertLease: () => undefined
};

function repository(events: string[], warnings = 0): ProcessingRepository {
  return {
    claim: async () => null,
    heartbeat: async () => new Date(),
    completeStage: async (_job, next) => { events.push(`complete:${next}`); },
    failStage: async () => undefined,
    recordWarning: async (_job, warning) => { events.push(`warning:${warning.code}`); },
    finalizeVersion: async (_job, status, code) => {
      events.push(`finalize:${status}:${code ?? 'none'}`);
    },
    countWarnings: async () => warnings,
    listTerminalVersions: async () => []
  };
}

function artifactStore(events: string[]): ArtifactStore & {
  values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();
  return {
    values,
    read: async (_workspace, _version, kind) => {
      const value = values.get(kind);
      if (!value) throw new Error(`missing ${kind}`);
      return value;
    },
    write: async (_workspace, _version, kind, bytes) => {
      events.push(`write:${kind}`);
      values.set(kind, bytes);
    },
    deleteVersion: async () => { events.push('cleanup'); }
  };
}

it('validate downloads into a per-job temporary directory, advances, and removes the directory', async () => {
  const events: string[] = [];
  let downloadedPath = '';
  const stage = createValidateStage({
    repository: repository(events),
    originalStore: {
      download: async (_original, destination) => {
        downloadedPath = destination;
        await writeFile(destination, pdfBytes);
      },
      remove: async () => undefined
    }
  });

  await stage(baseJob, guard);

  expect(events).toEqual(['complete:extract']);
  await expect(access(downloadedPath)).rejects.toThrow();
});

it('extract rechecks checksum, stores canonical normalized gzip, records warnings, and cleans temp files', async () => {
  const events: string[] = [];
  let downloadedPath = '';
  const artifacts = artifactStore(events);
  const stage = createExtractStage({
    repository: repository(events),
    artifactStore: artifacts,
    originalStore: {
      download: async (_original, destination) => {
        downloadedPath = destination;
        await writeFile(destination, pdfBytes);
      },
      remove: async () => undefined
    },
    extractorRegistry: {
      get: () => ({
        kind: 'pdf',
        extract: async () => ({
          blocks: [{
            index: 0,
            type: 'paragraph',
            text: '可检索正文',
            location: { schemaVersion: 1, kind: 'page', page: 1, label: 'Page 1' }
          }],
          warnings: [{ code: 'ocr_required', message: 'Page omitted' }]
        })
      })
    }
  });

  await stage({ ...baseJob, stage: 'extract' }, guard);

  expect(events).toEqual(['write:normalized', 'warning:ocr_required', 'complete:chunk']);
  await expect(decodeArtifact(artifacts.values.get('normalized')!, 'normalized'))
    .resolves.toMatchObject({ payload: [{ text: '可检索正文' }] });
  await expect(access(downloadedPath)).rejects.toThrow();
});

it('extract fails closed on checksum drift and still removes the temporary file', async () => {
  const events: string[] = [];
  let downloadedPath = '';
  const stage = createExtractStage({
    repository: repository(events),
    artifactStore: artifactStore(events),
    originalStore: {
      download: async (_original, destination) => {
        downloadedPath = destination;
        await writeFile(destination, Buffer.from('%PDF-1.4\nchanged\n'));
      },
      remove: async () => undefined
    },
    extractorRegistry: { get: () => undefined }
  });

  await expect(stage({ ...baseJob, stage: 'extract' }, guard))
    .rejects.toMatchObject({ code: 'corrupt_file', retryable: false });
  expect(events).toEqual([]);
  await expect(access(downloadedPath)).rejects.toThrow();
});

it('chunk decodes normalized data and stores deterministic chunk artifacts', async () => {
  const events: string[] = [];
  const artifacts = artifactStore(events);
  artifacts.values.set('normalized', await encodeArtifact({
    schemaVersion: 1,
    kind: 'normalized',
    configVersion: 'phase2-v1',
    payload: [{
      index: 0,
      type: 'paragraph',
      text: '第一句。第二句。',
      location: { schemaVersion: 1, kind: 'page', page: 1, label: 'Page 1' }
    }]
  }));
  const stage = createChunkStage({
    repository: repository(events),
    artifactStore: artifacts
  });

  await stage({ ...baseJob, stage: 'chunk' }, guard);

  expect(events).toEqual(['write:chunks', 'complete:embed']);
  await expect(decodeArtifact(artifacts.values.get('chunks')!, 'chunks'))
    .resolves.toMatchObject({ payload: [{ index: 0, content: '第一句。 第二句。' }] });
});

it('embed validates local passage vectors, replaces unpublished chunks, and advances', async () => {
  const events: string[] = [];
  const artifacts = artifactStore(events);
  artifacts.values.set('chunks', await encodeArtifact({
    schemaVersion: 1,
    kind: 'chunks',
    configVersion: 'phase2-v1',
    payload: [{
      index: 0,
      content: 'local passage',
      sourceLocation: { schemaVersion: 1, kind: 'page', page: 1, label: 'Page 1' }
    }]
  }));
  const stage = createEmbedStage({
    repository: repository(events),
    artifactStore: artifacts,
    embeddingProvider: {
      dimensions: 384,
      embedPassages: async (texts) => {
        events.push(`embed:${texts.join(',')}`);
        return [Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)];
      },
      embedQuery: async () => []
    },
    chunkRepository: {
      replaceUnpublished: async (_job, chunks) => {
        events.push(`replace:${chunks.length}:${chunks[0]?.embedding.length}`);
      }
    }
  });

  await stage({ ...baseJob, stage: 'embed' }, guard);

  expect(events).toEqual([
    'embed:local passage',
    'replace:1:384',
    'complete:finalize'
  ]);
});

it('finalize publishes partial warning state before best-effort exact artifact cleanup', async () => {
  const events: string[] = [];
  const stage = createFinalizeStage({
    repository: repository(events, 2),
    artifactStore: artifactStore(events),
    logger: { info: () => undefined, error: () => undefined }
  });

  await stage({ ...baseJob, stage: 'finalize' }, guard);

  expect(events).toEqual([
    'finalize:partially_searchable:ocr_required',
    'cleanup'
  ]);
});

it('cleanup removes an uploaded original and completes without a successor stage', async () => {
  const events: string[] = [];
  const stage = createCleanupStage({
    repository: repository(events),
    originalStore: {
      download: async () => undefined,
      remove: async (storagePath) => { events.push(`remove:${storagePath}`); }
    }
  });

  await stage({
    ...baseJob,
    stage: 'cleanup',
    original: { storagePath: 'workspace/version/source.pdf' }
  }, guard);

  expect(events).toEqual([
    'remove:workspace/version/source.pdf',
    'complete:null'
  ]);
});

it('cleanup completes a deleted web version without attempting a storage deletion', async () => {
  const events: string[] = [];
  const stage = createCleanupStage({
    repository: repository(events),
    originalStore: {
      download: async () => undefined,
      remove: async () => { events.push('remove'); }
    }
  });

  await stage({
    ...baseJob,
    stage: 'cleanup',
    original: { storagePath: null }
  }, guard);

  expect(events).toEqual(['complete:null']);
});
