import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { sha256File } from './fileHash';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

it('hashes a file as lowercase sha256', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'file-hash-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'original.pdf');
  const bytes = Buffer.from('%PDF-1.4\nsynthetic\n', 'utf8');
  await writeFile(filePath, bytes);

  await expect(sha256File(filePath, new AbortController().signal))
    .resolves.toBe(createHash('sha256').update(bytes).digest('hex'));
});

it('stops before reading when the signal is already aborted', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'file-hash-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'original.pdf');
  await writeFile(filePath, Buffer.from('%PDF-1.4\nsynthetic\n', 'utf8'));
  const controller = new AbortController();
  controller.abort(new Error('stop hashing'));

  await expect(sha256File(filePath, controller.signal))
    .rejects.toThrow('stop hashing');
});
