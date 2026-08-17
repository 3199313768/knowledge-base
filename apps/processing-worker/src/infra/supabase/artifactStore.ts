import { writeFile } from 'node:fs/promises';

import type { ArtifactKind } from '../../artifacts/codec';
import { ProcessingFailure } from '../../core/errors';
import type { ArtifactStore, OriginalStore } from '../../core/ports';

interface StorageResult<T> {
  data: T | null;
  error: unknown;
}

interface StorageBucket {
  upload(
    path: string,
    bytes: Uint8Array,
    options: Readonly<Record<string, unknown>>
  ): PromiseLike<StorageResult<unknown>>;
  download(path: string): PromiseLike<StorageResult<Blob>>;
  remove(paths: string[]): PromiseLike<StorageResult<unknown>>;
}

interface StorageBoundary {
  storage: {
    from(bucket: string): StorageBucket;
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fileByKind: Record<ArtifactKind, string> = {
  normalized: 'normalized-v1.json.gz',
  chunks: 'chunks-v1.json.gz'
};

export function createArtifactStore(client: StorageBoundary): ArtifactStore {
  const bucket = client.storage.from('processing-artifacts');
  return {
    async read(workspaceId, versionId, kind, signal) {
      const path = artifactPath(workspaceId, versionId, kind);
      signal.throwIfAborted();
      const result = await bucket.download(path);
      if (result.error || !(result.data instanceof Blob)) throw artifactFailure();
      const bytes = new Uint8Array(await result.data.arrayBuffer());
      signal.throwIfAborted();
      return bytes;
    },
    async write(workspaceId, versionId, kind, bytes, signal) {
      const path = artifactPath(workspaceId, versionId, kind);
      signal.throwIfAborted();
      const result = await bucket.upload(path, bytes, {
        contentType: 'application/gzip',
        upsert: true
      });
      if (result.error) throw artifactFailure();
      signal.throwIfAborted();
    },
    async deleteVersion(workspaceId, versionId, signal) {
      const paths = (['normalized', 'chunks'] as const).map((kind) =>
        artifactPath(workspaceId, versionId, kind)
      );
      signal.throwIfAborted();
      const result = await bucket.remove(paths);
      if (result.error) throw artifactFailure();
      signal.throwIfAborted();
    }
  };
}

export function createOriginalStore(client: StorageBoundary): OriginalStore {
  const bucket = client.storage.from('documents');
  return {
    async download(original, destinationPath, signal) {
      assertStoragePath(original.storagePath);
      signal.throwIfAborted();
      const result = await bucket.download(original.storagePath);
      if (result.error || !(result.data instanceof Blob)) throw downloadFailure();
      const bytes = new Uint8Array(await result.data.arrayBuffer());
      signal.throwIfAborted();
      try {
        await writeFile(destinationPath, bytes, { flag: 'wx' });
      } catch {
        throw artifactFailure();
      }
    }
  };
}

function artifactPath(
  workspaceId: string,
  versionId: string,
  kind: ArtifactKind
): string {
  assertUuid(workspaceId);
  assertUuid(versionId);
  return `processing/${workspaceId}/${versionId}/${fileByKind[kind]}`;
}

function assertStoragePath(value: string): void {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw downloadFailure();
  }
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) throw artifactFailure();
}

function artifactFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'artifact_io_failed',
    'The processing artifact operation failed.',
    true
  );
}

function downloadFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'storage_download_failed',
    'The original file could not be downloaded.',
    true
  );
}

export type ArtifactSupabaseBoundary = StorageBoundary;
