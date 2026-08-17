import type { NormalizedBlock, ProcessingWarning } from '@knowledge-base/contracts';

import type { ValidatedFile } from '../validation/fileValidation';
import { extractDocx } from './docx';
import { extractPdf } from './pdf';

export interface ExtractionResult {
  blocks: NormalizedBlock[];
  warnings: ProcessingWarning[];
}

export interface Extractor {
  readonly kind: 'pdf' | 'docx';
  extract(file: ValidatedFile, signal: AbortSignal): Promise<ExtractionResult>;
}

export function createExtractorRegistry(extractors: readonly Extractor[]): Map<Extractor['kind'], Extractor> {
  const registry = new Map<Extractor['kind'], Extractor>();
  for (const extractor of extractors) {
    if (registry.has(extractor.kind)) {
      throw new Error(`Duplicate extractor registration for ${extractor.kind}.`);
    }
    registry.set(extractor.kind, extractor);
  }
  return registry;
}

export function createBuiltinExtractorRegistry(): Map<Extractor['kind'], Extractor> {
  return createExtractorRegistry([
    { kind: 'pdf', extract: extractPdf },
    { kind: 'docx', extract: extractDocx }
  ]);
}
