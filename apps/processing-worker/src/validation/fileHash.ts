import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(
  filePath: string,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    const abort = () => {
      stream.destroy(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    stream.on('data', (chunk) => {
      signal.throwIfAborted();
      hash.update(chunk);
    });
    stream.on('error', (error) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    stream.on('end', () => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
  signal.throwIfAborted();
  return hash.digest('hex');
}
