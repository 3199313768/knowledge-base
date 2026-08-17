import type {
  ChunkDraft,
  NormalizedBlock,
  ProcessingSourceLocation
} from '@knowledge-base/contracts';

export interface ChunkingConfig {
  version: 'phase2-v1';
  maxCharacters: number;
  overlapCharacters: number;
}

const defaultConfig: ChunkingConfig = {
  version: 'phase2-v1',
  maxCharacters: 1_200,
  overlapCharacters: 120
};

interface UnindexedChunk {
  content: string;
  sourceLocation: ProcessingSourceLocation;
}

interface TableRow {
  content: string;
  row: number;
}

export function chunkBlocks(
  blocks: readonly NormalizedBlock[],
  config: Partial<ChunkingConfig> = {}
): ChunkDraft[] {
  const resolved = resolveConfig(config);
  const drafts: UnindexedChunk[] = [];

  for (const block of blocks) {
    drafts.push(...chunkBlock(block, resolved));
  }

  return drafts
    .filter((draft) => draft.content.length > 0)
    .map((draft, index) => ({ ...draft, index }));
}

function resolveConfig(config: Partial<ChunkingConfig>): ChunkingConfig {
  const allowedKeys = new Set<keyof ChunkingConfig>([
    'version',
    'maxCharacters',
    'overlapCharacters'
  ]);
  const unknownKey = Reflect.ownKeys(config).find(
    (key) => typeof key !== 'string' || !allowedKeys.has(key as keyof ChunkingConfig)
  );
  if (unknownKey !== undefined) {
    throw new Error(`Unknown chunk config field ${String(unknownKey)}.`);
  }

  const resolved = { ...defaultConfig, ...config };
  if (resolved.version !== 'phase2-v1') {
    throw new Error('Chunking config version must be phase2-v1.');
  }
  if (!Number.isInteger(resolved.maxCharacters) || resolved.maxCharacters < 1) {
    throw new Error('maxCharacters must be a positive integer.');
  }
  if (
    !Number.isInteger(resolved.overlapCharacters) ||
    resolved.overlapCharacters < 0 ||
    resolved.overlapCharacters >= resolved.maxCharacters
  ) {
    throw new Error(
      'overlapCharacters must be a non-negative integer below maxCharacters.'
    );
  }
  return resolved;
}

function chunkBlock(block: NormalizedBlock, config: ChunkingConfig): UnindexedChunk[] {
  if (
    block.type === 'table' &&
    block.location.kind === 'document' &&
    block.location.blockType === 'table'
  ) {
    return chunkTable(block, config);
  }

  return chunkParagraph(block.text, config).map((content) => ({
    content,
    sourceLocation: cloneLocation(block.location)
  }));
}

function chunkParagraph(text: string, config: ChunkingConfig): string[] {
  const units = boundaryUnits(text);
  const chunks: string[] = [];
  let current = '';

  const emitCurrent = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const unit of units) {
    if (unit.length > config.maxCharacters) {
      emitCurrent();
      const bounded = splitBounded(
        unit,
        config.maxCharacters,
        config.overlapCharacters
      );
      chunks.push(...bounded.slice(0, -1));
      current = bounded.at(-1) ?? '';
      continue;
    }

    if (!current) {
      current = unit;
      continue;
    }

    const combined = `${current} ${unit}`;
    if (combined.length <= config.maxCharacters) {
      current = combined;
      continue;
    }

    chunks.push(current);
    const availableOverlap = Math.max(
      0,
      Math.min(
        config.overlapCharacters,
        config.maxCharacters - unit.length - 1
      )
    );
    const overlap = availableOverlap > 0 ? current.slice(-availableOverlap) : '';
    current = overlap ? `${overlap} ${unit}` : unit;
  }

  emitCurrent();
  return chunks;
}

function boundaryUnits(text: string): string[] {
  const units: string[] = [];
  for (const paragraph of text.replace(/\r\n?/gu, '\n').split(/\n+/gu)) {
    const normalized = normalizeInlineWhitespace(paragraph);
    if (!normalized) continue;
    const sentences = normalized.match(
      /[^.!?。！？；;]+(?:[.!?。！？；;]+(?:["'”’」』])?|$)/gu
    );
    for (const sentence of sentences ?? [normalized]) {
      const unit = normalizeInlineWhitespace(sentence);
      if (unit) units.push(unit);
    }
  }
  return units;
}

function splitBounded(text: string, maximum: number, overlap: number): string[] {
  const chunks: string[] = [];
  const step = maximum - overlap;
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + maximum).trim();
    if (chunk) chunks.push(chunk);
    if (start + maximum >= text.length) break;
  }
  return chunks;
}

function chunkTable(block: NormalizedBlock, config: ChunkingConfig): UnindexedChunk[] {
  const location = block.location;
  if (location.kind !== 'document' || location.blockType !== 'table') return [];

  const sourceLines = block.text.replace(/\r\n?/gu, '\n').split('\n');
  const declaredRows = location.rowEnd! - location.rowStart! + 1;
  if (sourceLines.length !== declaredRows) {
    const normalized = normalizeInlineWhitespace(block.text);
    if (!normalized) return [];
    if (normalized.length <= config.maxCharacters || declaredRows === 1) {
      return splitBounded(normalized, config.maxCharacters, 0).map((content) => ({
        content,
        sourceLocation: cloneLocation(location)
      }));
    }
    throw new Error('Table text cannot be mapped to its declared row range.');
  }

  const rows: TableRow[] = sourceLines
    .map((line, offset) => ({
      content: normalizeInlineWhitespace(line),
      row: location.rowStart! + offset
    }))
    .filter((row) => row.content.length > 0);
  const chunks: UnindexedChunk[] = [];
  let currentRows: TableRow[] = [];

  const emitRows = () => {
    if (currentRows.length === 0) return;
    chunks.push({
      content: currentRows.map((row) => row.content).join('\n'),
      sourceLocation: narrowTableLocation(
        location,
        currentRows[0]!.row,
        currentRows.at(-1)!.row
      )
    });
    currentRows = [];
  };

  for (const row of rows) {
    if (row.content.length > config.maxCharacters) {
      emitRows();
      for (const content of splitBounded(row.content, config.maxCharacters, 0)) {
        chunks.push({
          content,
          sourceLocation: narrowTableLocation(location, row.row, row.row)
        });
      }
      continue;
    }

    const combinedLength =
      currentRows.reduce((length, item) => length + item.content.length, 0) +
      currentRows.length +
      row.content.length;
    if (currentRows.length > 0 && combinedLength > config.maxCharacters) emitRows();
    currentRows.push(row);
  }

  emitRows();
  return chunks;
}

function narrowTableLocation(
  location: Extract<ProcessingSourceLocation, { kind: 'document' }>,
  rowStart: number,
  rowEnd: number
): ProcessingSourceLocation {
  return {
    ...cloneLocation(location),
    rowStart,
    rowEnd
  } as ProcessingSourceLocation;
}

function cloneLocation(location: ProcessingSourceLocation): ProcessingSourceLocation {
  if (location.kind === 'page') return { ...location };
  return {
    ...location,
    ...(location.headingPath ? { headingPath: [...location.headingPath] } : {})
  };
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
