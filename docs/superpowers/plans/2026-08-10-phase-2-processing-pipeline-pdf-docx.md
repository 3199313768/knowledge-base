# Phase 2 Processing Pipeline and PDF/DOCX Search Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally verifiable Node.js worker that processes native-text PDF and DOCX files into deterministic, locatable, 384-dimensional searchable chunks and defines the backend hybrid-search contract.

**Architecture:** Use a modular-monolith worker with pure parsing, normalization, chunking, embedding, and ranking cores behind explicit Storage and database ports. Persist intermediate normalized/chunk artifacts in a Service-Role-only bucket, advance leased jobs with atomic RPCs, and publish only complete or explicitly partial non-current versions. Keep cloud execution and product UI outside this plan.

**Tech Stack:** Node.js ES2022, TypeScript 7, pnpm 11.9.0, Vitest 4, Supabase/PostgreSQL/pgvector, Transformers.js 4, PDF.js, yauzl, saxes, gzip JSON artifacts.

## Global Constraints

- The frozen product specification remains `docs/requirements/knowledge-base-app-design.md`.
- The approved Phase 2 design is `docs/superpowers/specs/2026-08-10-phase-2-processing-pipeline-pdf-docx-design.md`.
- Work directly in the current checkout; do not create an isolated branch or worktree unless the user changes that instruction.
- Do not stage, commit, push, open a PR, deploy, link Supabase, or mutate cloud state without separate explicit user authorization. Commit steps below are suggested checkpoints and must be skipped or paused when that authorization is absent.
- Phase 1 remains `NOT EVALUATED / NO-GO FOR RELEASE`; Phase 2 work is an explicit sequencing exception and is not Phase 1 evidence.
- Run only local tests and TypeScript checks. Do not run Supabase cloud tests, pgTAP requiring a database, a linked migration, or any real worker job.
- Tests and worker model startup must use the existing local `multilingual-e5-small` cache with remote model access disabled.
- Embeddings are exactly 384 finite values with `passage: ` and `query: ` prefixes.
- Only native-text PDF and DOCX are supported in this plan. OCR, webpages, PPTX, XLSX, images, and product UI remain out of scope.
- Service Role is worker-only. Search authorization is ordinary authenticated JWT plus RLS.
- Logs and errors must not contain file bodies, search text, vectors, OTPs, secrets, signed URLs, or raw parser exceptions.
- All test fixtures are synthetic and non-sensitive.
- TDD order is mandatory for implementation tasks: failing focused test, observed failure, minimal implementation, focused pass, then relevant local regression.

## Planned File Structure

```text
apps/processing-worker/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── config.ts
    ├── cli.ts
    ├── runner.ts
    ├── artifactSweeper.ts
    ├── core/
    │   ├── errors.ts
    │   ├── ports.ts
    │   └── stageMachine.ts
    ├── validation/fileValidation.ts
    ├── extractors/
    │   ├── registry.ts
    │   ├── pdf.ts
    │   └── docx.ts
    ├── chunking/chunkBlocks.ts
    ├── artifacts/codec.ts
    ├── stages/
    │   ├── validateStage.ts
    │   ├── extractStage.ts
    │   ├── chunkStage.ts
    │   ├── embedStage.ts
    │   └── finalizeStage.ts
    └── infra/supabase/
        ├── client.ts
        ├── processingRepository.ts
        ├── artifactStore.ts
        └── chunkRepository.ts
packages/contracts/src/
├── processing.ts
└── search.ts
packages/search-core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts
    ├── e5.ts
    ├── tokenize.ts
    ├── rrf.ts
    └── aggregate.ts
fixtures/processing/
├── generate.ts
├── manifest.json
└── generated fixture files
supabase/migrations/
├── 20260810000100_phase2_processing_pipeline.sql
└── 20260810000200_phase2_hybrid_search.sql
supabase/tests/
├── phase2_processing_pipeline_test.sql
└── phase2_hybrid_search_test.sql
validation/phase-2/local-decision.md
```

Test files live beside their production modules as `*.unit.test.ts`; cached-model tests use `*.model.test.ts`. The SQL files under `supabase/tests` are future cloud/database gates and are written but not executed in this plan.

---

### Task 1: Add Versioned Processing Contracts and the Worker Package Shell

**Files:**
- Create: `packages/contracts/src/processing.ts`
- Create: `packages/contracts/src/processing.test.ts`
- Modify: `packages/contracts/src/search.ts`
- Modify: `packages/contracts/src/search.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/processing-worker/package.json`
- Create: `apps/processing-worker/tsconfig.json`
- Create: `apps/processing-worker/vitest.config.ts`

**Interfaces:**
- Produces: `ProcessingSourceLocation`, `NormalizedBlock`, `ChunkDraft`, `ProcessingErrorCode`, `ProcessingWarning`, `assertProcessingSourceLocation(value): asserts value is ProcessingSourceLocation`, and the `@knowledge-base/processing-worker` workspace package.
- Consumes: existing `EmbeddingProvider`, `SearchQuery`, and `SearchResult` contracts without breaking Phase 0 slide/sheet/image/web fixtures.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { assertProcessingSourceLocation } from './processing';

describe('assertProcessingSourceLocation', () => {
  it('accepts a one-based PDF page', () => {
    expect(() => assertProcessingSourceLocation({
      schemaVersion: 1,
      kind: 'page',
      page: 3,
      label: '第 3 页'
    })).not.toThrow();
  });

  it('rejects a zero page and inconsistent document rows', () => {
    expect(() => assertProcessingSourceLocation({
      schemaVersion: 1,
      kind: 'page',
      page: 0,
      label: '第 0 页'
    })).toThrow('page must be a positive integer');
    expect(() => assertProcessingSourceLocation({
      schemaVersion: 1,
      kind: 'document',
      blockType: 'table',
      blockStart: 2,
      blockEnd: 2,
      tableIndex: 1,
      rowStart: 4,
      rowEnd: 2,
      label: '表格 1'
    })).toThrow('row range');
  });
});
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run: `pnpm --filter @knowledge-base/contracts exec vitest run src/processing.test.ts`

Expected: FAIL because `./processing` and `assertProcessingSourceLocation` do not exist.

- [ ] **Step 3: Implement the strict processing contracts**

```ts
export type ProcessingSourceLocation =
  | {
      schemaVersion: 1;
      kind: 'page';
      page: number;
      label: string;
    }
  | {
      schemaVersion: 1;
      kind: 'document';
      blockType: 'paragraph' | 'table';
      blockStart: number;
      blockEnd: number;
      headingPath?: string[];
      tableIndex?: number;
      rowStart?: number;
      rowEnd?: number;
      label: string;
    };

export interface NormalizedBlock {
  index: number;
  type: 'paragraph' | 'table';
  text: string;
  location: ProcessingSourceLocation;
}

export interface ChunkDraft {
  index: number;
  content: string;
  sourceLocation: ProcessingSourceLocation;
}
```

Add the exact permanent and transient error-code unions from the approved design, including `ocr_required`. Validate schema version, positive one-based source indices, zero-based chunk indices, non-empty labels, ordered ranges, and table-only fields. Keep the pre-existing generic `SourceLocation` accepted by Phase 0 search fixtures; define the new strict type separately and allow `SearchResult.sourceLocation` to accept either type during migration.

- [ ] **Step 4: Create the worker package shell**

Use this package script contract:

```json
{
  "name": "@knowledge-base/processing-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/cli.ts",
    "test:unit": "vitest run --config vitest.config.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Extend `../../tsconfig.base.json`, enable Node and Vitest types, and include `src/**/*.ts` plus `vitest.config.ts`. Configure Vitest to include only `src/**/*.unit.test.ts` and exclude `src/**/*.model.test.ts`.

- [ ] **Step 5: Run focused and contract regression tests**

Run: `pnpm --filter @knowledge-base/contracts test:unit`

Expected: PASS, including the pre-existing Phase 0 search contract tests.

- [ ] **Step 6: Suggested commit checkpoint, only if separately authorized**

```bash
git add packages/contracts apps/processing-worker
git commit -m "feat: define phase-2 processing contracts"
```

---

### Task 2: Promote the Offline E5 Provider into a Shared Search Core

**Files:**
- Create: `packages/search-core/package.json`
- Create: `packages/search-core/tsconfig.json`
- Create: `packages/search-core/vitest.config.ts`
- Create: `packages/search-core/src/index.ts`
- Create: `packages/search-core/src/e5.ts`
- Create: `packages/search-core/src/e5.unit.test.ts`
- Create: `packages/search-core/src/e5.model.test.ts`
- Modify: `apps/search-spike/package.json`
- Modify: `apps/search-spike/src/embed.ts`
- Modify: `apps/search-spike/src/embed.unit.test.ts`

**Interfaces:**
- Consumes: `EmbeddingProvider` from `@knowledge-base/contracts`.
- Produces: `createMultilingualE5Provider(options: E5ProviderOptions): Promise<EmbeddingProvider>` and `assertEmbedding(vector: readonly number[]): void`.

- [ ] **Step 1: Add the shared-package test and mocked offline contract**

```ts
const extractor = vi.fn(async () => ({ data: Float32Array.from([1, 0]) }));
const pipeline = vi.fn(async () => extractor);

it('disables remote models and applies E5 prefixes', async () => {
  const provider = await createMultilingualE5Provider({
    cacheDir: '/synthetic/cache',
    localFilesOnly: true
  });
  await provider.embedPassages(['报价方案']);
  await provider.embedQuery('报价方案');
  expect(mockedEnv.allowRemoteModels).toBe(false);
  expect(extractor).toHaveBeenNthCalledWith(1, 'passage: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
  expect(extractor).toHaveBeenNthCalledWith(2, 'query: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
});
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `pnpm --filter @knowledge-base/search-core exec vitest run src/e5.unit.test.ts`

Expected: FAIL because the package and provider do not exist.

- [ ] **Step 3: Add the package and implement the provider**

After dependency installation is authorized, create the package manifest and run:

```bash
pnpm add --filter @knowledge-base/search-core '@knowledge-base/contracts@workspace:*' @huggingface/transformers@^4.2.0
pnpm add --filter @knowledge-base/search-core --save-dev @types/node typescript vitest
```

Move the provider logic out of `apps/search-spike/src/embed.ts`. Set `env.cacheDir` from the required option, set `env.allowRemoteModels = false` when `localFilesOnly` is true, and keep `Xenova/multilingual-e5-small`, mean pooling, normalization, and the E5 prefixes. `assertEmbedding` must reject a vector unless it contains exactly 384 finite numbers.

The package scripts are:

```json
{
  "test:unit": "vitest run --config vitest.config.ts",
  "test:model": "vitest run src/e5.model.test.ts",
  "typecheck": "tsc --noEmit"
}
```

The unit config excludes `*.model.test.ts`. The model test resolves `validation/phase-0/model-cache`, sets offline mode before provider creation, embeds one passage and one query, and verifies 384 normalized values without downloading.

- [ ] **Step 4: Preserve the Phase 0 import surface**

Make `apps/search-spike/src/embed.ts` a compatibility re-export:

```ts
export { createMultilingualE5Provider } from '@knowledge-base/search-core';
```

Pass the existing repository cache path at spike call sites. Add `@knowledge-base/search-core: workspace:*` to the spike and remove its direct Transformers.js dependency after the shared package owns it.

- [ ] **Step 5: Run local tests**

Run:

```bash
pnpm --filter @knowledge-base/search-core test:unit
pnpm --filter @knowledge-base/search-spike test:unit
pnpm --filter @knowledge-base/search-core test:model
```

Expected: all PASS; the final command uses only the existing cache and makes no network request.

- [ ] **Step 6: Suggested commit checkpoint, only if separately authorized**

```bash
git add packages/search-core apps/search-spike pnpm-lock.yaml
git commit -m "refactor: share the offline e5 provider"
```

---

### Task 3: Build Synthetic Fixtures and File Validation

**Files:**
- Create: `fixtures/processing/generate.ts`
- Create: `fixtures/processing/manifest.json`
- Create: generated files under `fixtures/processing/files/`
- Create: `apps/processing-worker/src/core/errors.ts`
- Create: `apps/processing-worker/src/validation/fileValidation.ts`
- Create: `apps/processing-worker/src/validation/fileValidation.unit.test.ts`
- Modify: `apps/processing-worker/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ProcessingFailure`, `validateOriginalFile(input: OriginalFileDescriptor): Promise<ValidatedFile>`, `detectFileKind(header): 'pdf' | 'docx'`, and the fixed synthetic corpus.
- Consumes: `ProcessingErrorCode` from contracts.

- [ ] **Step 1: Add parser and fixture-generation dependencies**

Run only after dependency installation is authorized:

```bash
pnpm add --filter @knowledge-base/processing-worker pdfjs-dist yauzl saxes '@knowledge-base/contracts@workspace:*' '@knowledge-base/search-core@workspace:*' @supabase/supabase-js dotenv
pnpm add --filter @knowledge-base/processing-worker --save-dev @types/node @types/yauzl @types/pdfkit @types/yazl pdfkit yazl tsx typescript vitest
```

The lockfile records exact resolved versions. Do not add postinstall exceptions beyond the existing allowlist unless a reviewed dependency actually requires one.

- [ ] **Step 2: Write validation tests before implementation**

```ts
it.each([
  ['native-text.pdf', 'application/pdf', 'pdf'],
  ['paragraphs-and-table.docx', DOCX_MIME, 'docx']
])('validates %s by bytes, not extension', async (name, mime, kind) => {
  await expect(validateOriginalFile(fixtureDescriptor(name, mime)))
    .resolves.toMatchObject({ kind, sizeBytes: expect.any(Number) });
});

it('rejects declared PDF containing DOCX bytes', async () => {
  await expect(validateOriginalFile(
    fixtureDescriptor('paragraphs-and-table.docx', 'application/pdf')
  )).rejects.toMatchObject({ code: 'mime_mismatch', retryable: false });
});
```

- [ ] **Step 3: Generate the versioned synthetic corpus**

`generate.ts` uses PDFKit and yazl to produce deterministic content with fixed document metadata and timestamps:

- `native-text.pdf`: three pages, bilingual text, page 2 empty;
- `empty.pdf`;
- `encrypted.pdf`: PDFKit `userPassword` and `ownerPassword` options;
- `corrupt.pdf`;
- `paragraphs-and-table.docx`: Heading 1, two paragraphs, a 3-row table;
- `empty.docx`;
- `corrupt.docx`;
- `oversized-entry.docx`: one compressed entry whose declared expanded size exceeds 50 MB;
- `pdf-named-as-docx.docx`.

The generator writes `manifest.json` containing filename, synthetic purpose, MIME, byte size, and SHA-256. A unit test regenerates into a temporary directory and compares checksums, so fixtures cannot drift silently.

- [ ] **Step 4: Observe the expected validation failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/validation/fileValidation.unit.test.ts`

Expected: FAIL because `validateOriginalFile` does not exist.

- [ ] **Step 5: Implement bounded file validation**

```ts
export interface OriginalFileDescriptor {
  filePath: string;
  declaredMime: string;
  expectedSizeBytes: number;
}

export interface ValidatedFile extends OriginalFileDescriptor {
  kind: 'pdf' | 'docx';
  sizeBytes: number;
}
```

Use `stat` and a bounded header read. Enforce `1..100000000` bytes, compare the actual size to the recorded size, detect `%PDF-` for PDF and ZIP magic plus required DOCX entries for DOCX, and return stable errors. Never include the path, body, or parser exception in `ProcessingFailure.message`.

- [ ] **Step 6: Run validation tests**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/validation/fileValidation.unit.test.ts`

Expected: PASS for valid files and stable failure codes for empty, corrupt, oversized, and mismatched inputs.

- [ ] **Step 7: Suggested commit checkpoint, only if separately authorized**

```bash
git add fixtures/processing apps/processing-worker pnpm-lock.yaml
git commit -m "test: add safe phase-2 processing fixtures"
```

---

### Task 4: Implement Native-Text PDF Extraction

**Files:**
- Create: `apps/processing-worker/src/extractors/pdf.ts`
- Create: `apps/processing-worker/src/extractors/pdf.unit.test.ts`
- Create: `apps/processing-worker/src/extractors/registry.ts`

**Interfaces:**
- Consumes: `ValidatedFile` with `kind: 'pdf'`.
- Produces: `extractPdf(file, signal): Promise<ExtractionResult>` where `ExtractionResult` contains `blocks: NormalizedBlock[]` and `warnings: ProcessingWarning[]`.

- [ ] **Step 1: Write PDF behavior tests**

```ts
it('preserves page locations and never emits an empty page', async () => {
  const result = await extractPdf(pdfFixture('native-text.pdf'), AbortSignal.timeout(5_000));
  expect(result.blocks.map((block) => block.location)).toEqual([
    expect.objectContaining({ kind: 'page', page: 1, label: '第 1 页' }),
    expect.objectContaining({ kind: 'page', page: 3, label: '第 3 页' })
  ]);
  expect(result.blocks.every((block) => block.text.trim().length > 0)).toBe(true);
});

it('maps password protection and all-empty pages to stable errors', async () => {
  await expect(extractPdf(pdfFixture('encrypted.pdf'), AbortSignal.timeout(5_000)))
    .rejects.toMatchObject({ code: 'encrypted_file' });
  await expect(extractPdf(pdfFixture('empty.pdf'), AbortSignal.timeout(5_000)))
    .rejects.toMatchObject({ code: 'ocr_required' });
});
```

- [ ] **Step 2: Run the PDF test and observe failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/extractors/pdf.unit.test.ts`

Expected: FAIL because `extractPdf` is missing.

- [ ] **Step 3: Implement extraction with PDF.js**

Import `getDocument` from `pdfjs-dist/legacy/build/pdf.mjs`. Read the synthetic file into a `Uint8Array`, call `getDocument` with network and evaluation features disabled, iterate pages in order, and group text items into paragraphs using vertical gaps. Emit one-based page locations and sequential one-based block indices. Destroy the PDF loading task in `finally`.

Map PDF.js password errors to `encrypted_file`, format errors to `corrupt_file`, aborts/timeouts to retryable `worker_timeout`, and a document with no reliable text to `ocr_required`. Catch per-page extraction failures as structured warnings when other pages produced reliable content.

- [ ] **Step 4: Register the adapter**

```ts
export interface Extractor {
  readonly kind: 'pdf' | 'docx';
  extract(file: ValidatedFile, signal: AbortSignal): Promise<ExtractionResult>;
}

export function createExtractorRegistry(extractors: readonly Extractor[]) {
  return new Map(extractors.map((extractor) => [extractor.kind, extractor]));
}
```

Reject duplicate adapter registrations at startup.

- [ ] **Step 5: Run PDF and validation regression tests**

Run:

```bash
pnpm --filter @knowledge-base/processing-worker exec vitest run src/extractors/pdf.unit.test.ts src/validation/fileValidation.unit.test.ts
```

Expected: PASS with no network access.

- [ ] **Step 6: Suggested commit checkpoint, only if separately authorized**

```bash
git add apps/processing-worker/src/extractors
git commit -m "feat: extract locatable native pdf text"
```

---

### Task 5: Implement Safe DOCX Paragraph and Table Extraction

**Files:**
- Create: `apps/processing-worker/src/extractors/docx.ts`
- Create: `apps/processing-worker/src/extractors/docx.unit.test.ts`
- Modify: `apps/processing-worker/src/extractors/registry.ts`

**Interfaces:**
- Consumes: `ValidatedFile` with `kind: 'docx'`.
- Produces: `extractDocx(file, signal): Promise<ExtractionResult>` and `assertSafeArchiveEntry(entry): void`.

- [ ] **Step 1: Write DOCX structure and archive-safety tests**

```ts
it('keeps paragraphs and tables in document order', async () => {
  const result = await extractDocx(docxFixture('paragraphs-and-table.docx'), AbortSignal.timeout(5_000));
  expect(result.blocks.map(({ type }) => type)).toEqual([
    'paragraph', 'paragraph', 'paragraph', 'table'
  ]);
  expect(result.blocks.at(-1)?.location).toMatchObject({
    kind: 'document',
    blockType: 'table',
    tableIndex: 1,
    rowStart: 1,
    rowEnd: 3
  });
});

it.each(['../word/document.xml', '/word/document.xml', 'word/../../x'])
  ('rejects unsafe entry %s', (name) => {
    expect(() => assertSafeArchiveEntry({ fileName: name, uncompressedSize: 1 }))
      .toThrow('unsafe_archive');
  });
```

- [ ] **Step 2: Run the DOCX test and observe failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/extractors/docx.unit.test.ts`

Expected: FAIL because `extractDocx` and `assertSafeArchiveEntry` do not exist.

- [ ] **Step 3: Implement bounded ZIP reading**

Open with yauzl using lazy entries. Reject absolute paths, `..` path segments, backslashes, more than 10,000 entries, an entry larger than 50 MB, or cumulative expanded bytes above 500 MB. Read only `[Content_Types].xml`, `word/document.xml`, and the style metadata needed for heading names. Do not resolve external relationships or fetch any URL.

- [ ] **Step 4: Implement streaming WordprocessingML extraction**

Use saxes with namespace-aware tag names. Preserve body order for `w:p` and `w:tbl`, accumulate `w:t` text, map heading paragraph styles into `headingPath`, and flatten each table row into tab-separated cells with newline-separated rows. Assign one-based paragraph, table, row, and block positions. Exclude empty blocks.

The parser state must be local to one call; no module-level mutable buffers are allowed.

- [ ] **Step 5: Map stable failures and partial warnings**

Map invalid ZIP/XML to `corrupt_file`, safety-limit breaches to `unsafe_archive`, aborts to `worker_timeout`, and zero extracted blocks to `empty_content`. A recoverable malformed non-body part may produce a structured warning; an unreadable `word/document.xml` always fails.

- [ ] **Step 6: Run DOCX, PDF, and validation tests**

Run:

```bash
pnpm --filter @knowledge-base/processing-worker exec vitest run src/extractors/docx.unit.test.ts src/extractors/pdf.unit.test.ts src/validation/fileValidation.unit.test.ts
```

Expected: PASS, including archive caps and document-order assertions.

- [ ] **Step 7: Suggested commit checkpoint, only if separately authorized**

```bash
git add apps/processing-worker/src/extractors
git commit -m "feat: extract safe docx paragraphs and tables"
```

---

### Task 6: Add Deterministic Chunking and Versioned Artifact Codecs

**Files:**
- Create: `apps/processing-worker/src/chunking/chunkBlocks.ts`
- Create: `apps/processing-worker/src/chunking/chunkBlocks.unit.test.ts`
- Create: `apps/processing-worker/src/artifacts/codec.ts`
- Create: `apps/processing-worker/src/artifacts/codec.unit.test.ts`

**Interfaces:**
- Consumes: `NormalizedBlock[]`.
- Produces: `chunkBlocks(blocks, config?): ChunkDraft[]`, `encodeArtifact(envelope): Promise<Uint8Array>`, and `decodeArtifact(bytes, expectedKind)`.

- [ ] **Step 1: Write chunk-boundary and determinism tests**

```ts
const config = { version: 'phase2-v1', maxCharacters: 1200, overlapCharacters: 120 } as const;

it('is deterministic and never crosses PDF pages', () => {
  const first = chunkBlocks(pdfBlocks, config);
  const second = chunkBlocks(structuredClone(pdfBlocks), config);
  expect(second).toEqual(first);
  expect(first.map((chunk) => chunk.index)).toEqual(first.map((_, index) => index));
  expect(first.every((chunk) => chunk.content.length <= 1200)).toBe(true);
  expect(first.every((chunk) => chunk.sourceLocation.kind === 'page')).toBe(true);
});
```

Add table tests proving row ranges narrow correctly and paragraph tests proving overlap remains inside one source block.

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/chunking/chunkBlocks.unit.test.ts src/artifacts/codec.unit.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the versioned chunker**

Use exact defaults `maxCharacters: 1200` and `overlapCharacters: 120`. Normalize whitespace, split first by source block, then by paragraph/sentence boundaries, and use a bounded character fallback for overlong segments. Never merge PDF pages or unrelated DOCX tables. Assign zero-based contiguous chunk indices after empty outputs are removed.

- [ ] **Step 4: Implement gzip JSON artifact envelopes**

```ts
type ArtifactEnvelope =
  | { schemaVersion: 1; kind: 'normalized'; configVersion: 'phase2-v1'; payload: NormalizedBlock[] }
  | { schemaVersion: 1; kind: 'chunks'; configVersion: 'phase2-v1'; payload: ChunkDraft[] };
```

Use Node `gzip`/`gunzip`, reject decompressed JSON above 100 MB, validate every decoded location, reject a mismatched `kind`, and produce byte-identical output for identical input by fixing gzip metadata.

- [ ] **Step 5: Run chunking and codec tests**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/chunking/chunkBlocks.unit.test.ts src/artifacts/codec.unit.test.ts`

Expected: PASS with deterministic snapshots.

- [ ] **Step 6: Suggested commit checkpoint, only if separately authorized**

```bash
git add apps/processing-worker/src/chunking apps/processing-worker/src/artifacts
git commit -m "feat: add deterministic processing artifacts"
```

---

### Task 7: Extend the Database for Leased Atomic Processing

**Files:**
- Create: `supabase/migrations/20260810000100_phase2_processing_pipeline.sql`
- Create: `supabase/tests/phase2_processing_pipeline_test.sql`
- Create: `apps/processing-worker/src/core/stageMachine.ts`
- Create: `apps/processing-worker/src/core/stageMachine.unit.test.ts`
- Modify: `apps/cloud-foundation/src/processing-state.cloud.test.ts`

**Interfaces:**
- Produces database RPCs `claim_processing_job(text, integer)`, `heartbeat_processing_job(uuid, text, integer)`, `complete_processing_stage(uuid, text, processing_stage)`, `fail_processing_stage(uuid, text, text, boolean)`, `record_processing_warning(uuid, text, text, jsonb)`, and `finalize_processing_version(uuid, text, file_version_status, text)`.
- Produces pure `nextStage(stage): ProcessingStage | null` and `retryDelayMs(attempt): number | null` for local tests.
- Consumes the Phase 1 transition trigger, current-version invariant, and Service Role grants.

- [ ] **Step 1: Write pure transition tests**

```ts
it('uses the approved stage sequence and three total attempts', () => {
  expect(nextStage('validate')).toBe('extract');
  expect(nextStage('extract')).toBe('chunk');
  expect(nextStage('chunk')).toBe('embed');
  expect(nextStage('embed')).toBe('finalize');
  expect(nextStage('finalize')).toBeNull();
  expect(retryDelayMs(1)).toBe(30_000);
  expect(retryDelayMs(2)).toBe(120_000);
  expect(retryDelayMs(3)).toBeNull();
});
```

- [ ] **Step 2: Run the transition test and observe failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/core/stageMachine.unit.test.ts`

Expected: FAIL because the stage machine is missing.

- [ ] **Step 3: Implement the pure stage machine**

Do not include OCR in the active sequence. Reject transitions that skip, repeat, or move backward. Keep cleanup outside this chain because it retains the Phase 1 deleted-file meaning.

- [ ] **Step 4: Write the Phase 2 processing migration**

The migration must:

1. backfill `content_chunks.chunk_index` with `row_number() over (partition by version_id order by created_at, id) - 1`, then add NOT NULL and unique `(version_id, chunk_index)`;
2. add `worker_id` and `lease_expires_at` to `processing_jobs` plus a pending/lease index;
3. add append-only `processing_warnings` with workspace-member SELECT RLS and Service-Role-only INSERT;
4. create private `processing-artifacts` with 100 MB gzip-object limit and no anon/authenticated object policy;
5. create a private source-location validator and enforce schema version, kind, positive indices, ordered ranges, and non-empty labels for both chunks and warnings;
6. revoke Service Role execution on the legacy no-argument claim/complete/finalize functions;
7. create the six new Worker-only RPCs with fully qualified names and `search_path = ''`;
8. validate lease ownership on heartbeat, completion, failure, warning, and finalization;
9. atomically complete a stage and insert exactly its allowed successor;
10. schedule attempt 2 at `now() + interval '30 seconds'`, attempt 3 at `now() + interval '2 minutes'`, and make attempt 3 failure terminal;
11. atomically complete the final job and call the same current-version invariants used by Phase 1.

Do not grant any Worker RPC to `anon` or `authenticated`.

- [ ] **Step 5: Add database tests but keep them UNRUN**

`supabase/tests/phase2_processing_pipeline_test.sql` covers unique chunk indices, invalid locations, lease theft, expired lease reclaim, legal and illegal successor stages, three-attempt bounds, partial warnings, final publication, and old-current preservation. Label its header `UNRUN until a dedicated database target is separately authorized`.

Update the Phase 1 cloud-test source to call the new signatures so future combined gates do not retain a revoked path. Do not execute it in this plan.

- [ ] **Step 6: Run allowed local checks**

Run:

```bash
pnpm --filter @knowledge-base/processing-worker exec vitest run src/core/stageMachine.unit.test.ts
git diff --check
```

Expected: the local pure transition checks PASS. Review the migration statically and record the pgTAP file as UNRUN; static review is not database behavior evidence.

- [ ] **Step 7: Suggested commit checkpoint, only if separately authorized**

```bash
git add supabase/migrations/20260810000100_phase2_processing_pipeline.sql supabase/tests/phase2_processing_pipeline_test.sql apps/processing-worker apps/cloud-foundation/src/processing-state.cloud.test.ts
git commit -m "feat: add leased phase-2 processing state"
```

---

### Task 8: Implement Supabase Adapters, Stage Handlers, and the Local Runner

**Files:**
- Create: `apps/processing-worker/src/core/ports.ts`
- Create: `apps/processing-worker/src/config.ts`
- Create: `apps/processing-worker/src/config.unit.test.ts`
- Create: `apps/processing-worker/src/infra/supabase/client.ts`
- Create: `apps/processing-worker/src/infra/supabase/processingRepository.ts`
- Create: `apps/processing-worker/src/infra/supabase/processingRepository.unit.test.ts`
- Create: `apps/processing-worker/src/infra/supabase/artifactStore.ts`
- Create: `apps/processing-worker/src/infra/supabase/artifactStore.unit.test.ts`
- Create: `apps/processing-worker/src/infra/supabase/chunkRepository.ts`
- Create: `apps/processing-worker/src/infra/supabase/chunkRepository.unit.test.ts`
- Create: `apps/processing-worker/src/stages/validateStage.ts`
- Create: `apps/processing-worker/src/stages/extractStage.ts`
- Create: `apps/processing-worker/src/stages/chunkStage.ts`
- Create: `apps/processing-worker/src/stages/embedStage.ts`
- Create: `apps/processing-worker/src/stages/finalizeStage.ts`
- Create: `apps/processing-worker/src/stages/stages.unit.test.ts`
- Create: `apps/processing-worker/src/runner.ts`
- Create: `apps/processing-worker/src/runner.unit.test.ts`
- Create: `apps/processing-worker/src/artifactSweeper.ts`
- Create: `apps/processing-worker/src/artifactSweeper.unit.test.ts`
- Create: `apps/processing-worker/src/cli.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: processing RPCs from Task 7, extractors from Tasks 4–5, chunker/artifacts from Task 6, and E5 provider from Task 2.
- Produces: `runOne(dependencies, workerId, signal): Promise<'processed' | 'idle'>`, `runLoop(...)`, and infrastructure implementations of the core ports.

- [ ] **Step 1: Define ports and write runner tests with fakes**

```ts
it('processes validate through finalize without skipping a successor', async () => {
  const fake = createPipelineFake({ initialStage: 'validate' });
  await expect(runOne(fake.dependencies, 'worker-a', AbortSignal.timeout(5_000)))
    .resolves.toBe('processed');
  expect(fake.events).toEqual([
    'claim:validate', 'validate', 'complete:extract'
  ]);
});

it('stops heartbeating and reports a retryable model failure by code', async () => {
  const fake = createPipelineFake({ initialStage: 'embed', failWith: 'model_load_failed' });
  await runOne(fake.dependencies, 'worker-a', AbortSignal.timeout(5_000));
  expect(fake.events).toContain('fail:model_load_failed:retryable');
  expect(fake.logs.join(' ')).not.toContain(fake.secretBodyText);
});
```

Ports must carry typed DTOs rather than Supabase response shapes. Include `ProcessingRepository`, `OriginalStore`, `ArtifactStore`, `ChunkRepository`, `ExtractorRegistry`, `EmbeddingProvider`, `Clock`, and a redacting `Logger`.

- [ ] **Step 2: Run the runner test and observe failure**

Run: `pnpm --filter @knowledge-base/processing-worker exec vitest run src/runner.unit.test.ts`

Expected: FAIL because ports and runner do not exist.

- [ ] **Step 3: Implement strict worker configuration**

Require `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROCESSING_WORKER_ID`, and `PROCESSING_MODEL_CACHE`. Default lease to 120 seconds, heartbeat to 40 seconds, idle poll to 2 seconds, artifact sweep interval to 15 minutes, terminal-artifact grace period to 1 hour, and per-job timeout to 15 minutes. Reject a cache path without the expected model files before claiming work. Never print environment values. Add focused config tests using synthetic environment objects rather than mutating the process-wide environment.

Add names, without values, to `.env.example` and label them worker-only.

- [ ] **Step 4: Implement the Supabase adapters**

- `processingRepository` calls only the new Worker RPCs and maps errors to stable infrastructure codes;
- `artifactStore` reads/writes gzip objects under the exact workspace/version prefix and rejects any parsed path that escapes it;
- `chunkRepository` deletes and rebuilds chunks only for the claimed non-current processing version, batches inserts, and validates every vector before sending;
- `client` disables session persistence and refresh and never exports credentials.

Unit-test adapters with a fake Supabase client. Do not create a real client in tests.

- [ ] **Step 5: Implement one handler per stage**

- `validateStage`: download to a per-job temporary directory, validate, then complete to `extract`;
- `extractStage`: download the original into a new per-job temporary directory, recheck its checksum/size, select the registered adapter, encode normalized output, store `normalized-v1.json.gz`, record warnings, then complete to `chunk`;
- `chunkStage`: decode normalized blocks, create deterministic chunks, store `chunks-v1.json.gz`, then complete to `embed`;
- `embedStage`: decode chunks, batch local passage embeddings, rebuild unpublished chunks, then complete to `finalize`;
- `finalizeStage`: derive `searchable` or `partially_searchable` from warnings and atomically finalize.

Every handler must be retry-idempotent and accept an `AbortSignal`. The terminal failure path and successful finalization both request exact-prefix artifact deletion after the database transaction; deletion failure is logged only as `artifact_cleanup_failed` and does not roll back an already published version.

- [ ] **Step 6: Implement artifact sweeping**

`artifactSweeper.ts` asks the repository for at most 100 terminal versions older than one hour, derives the exact `processing/{workspace_id}/{version_id}/` prefix, and deletes only that prefix. Unit tests must prove it skips active versions, caps each pass, rejects malformed IDs, and cannot delete a workspace-level prefix. Run it at startup and every 15 minutes.

- [ ] **Step 7: Implement lease heartbeat and graceful shutdown**

`runOne` starts heartbeat only after a claim, stops it in `finally`, and refuses to complete after lease loss. `runLoop` stops claiming on SIGINT/SIGTERM, allows the current handler to finish within its cancellation budget, removes temporary files, and exits without logging content.

- [ ] **Step 8: Run the full worker unit suite and typecheck**

Run:

```bash
pnpm --filter @knowledge-base/processing-worker test:unit
pnpm --filter @knowledge-base/processing-worker typecheck
```

Expected: PASS with fakes only; no Supabase URL or key is read by tests.

- [ ] **Step 9: Suggested commit checkpoint, only if separately authorized**

```bash
git add apps/processing-worker .env.example pnpm-lock.yaml
git commit -m "feat: orchestrate the local processing worker"
```

---

### Task 9: Implement Hybrid Search Core and the User-Scoped Search Migration

**Files:**
- Create: `packages/search-core/src/tokenize.ts`
- Create: `packages/search-core/src/tokenize.unit.test.ts`
- Create: `packages/search-core/src/rrf.ts`
- Create: `packages/search-core/src/rrf.unit.test.ts`
- Create: `packages/search-core/src/aggregate.ts`
- Create: `packages/search-core/src/aggregate.unit.test.ts`
- Modify: `packages/search-core/src/index.ts`
- Modify: `packages/contracts/src/search.ts`
- Modify: `packages/contracts/src/search.test.ts`
- Create: `supabase/migrations/20260810000200_phase2_hybrid_search.sql`
- Create: `supabase/tests/phase2_hybrid_search_test.sql`
- Modify: `apps/processing-worker/src/infra/supabase/chunkRepository.ts`
- Modify: `apps/processing-worker/src/infra/supabase/chunkRepository.unit.test.ts`

**Interfaces:**
- Produces: `tokenizeLexical(text): string[]`, `fuseRrf(lists, config): RankedChunk[]`, `aggregateFiles(chunks): SearchResult[]`, `toVectorLiteral(vector): string`, and database RPC `search_workspace_files(uuid, vector, text[], text, jsonb, integer)`.
- Consumes: current-version file/chunk schema, 384-dimensional E5 queries, strict source locations, and ordinary authenticated JWT RLS.

- [ ] **Step 1: Write tokenizer, fusion, and aggregation tests**

```ts
it('creates Chinese bigrams and normalized Latin terms', () => {
  expect(tokenizeLexical('去年 Quote-2025 报价')).toEqual([
    '去年', 'quote', '2025', '报价'
  ]);
});

it('uses weighted RRF without rewarding missing ranks', () => {
  expect(fuseRrf([
    { weight: 0.65, ids: ['semantic-only', 'both'] },
    { weight: 0.35, ids: ['both', 'lexical-only'] }
  ], { k: 60 })).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'both' })
  ]));
  expect(fuseRrf(/* same input */, { k: 60 })[0]?.id).toBe('both');
});
```

Add tests for exact filename boost, maximum three snippets, bounded second-snippet contribution, filters, recency tie-break only, and one result per file.

- [ ] **Step 2: Run search-core tests and observe failure**

Run: `pnpm --filter @knowledge-base/search-core exec vitest run src/tokenize.unit.test.ts src/rrf.unit.test.ts src/aggregate.unit.test.ts`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement the versioned local ranking core**

Use Unicode NFKC normalization, lowercase Latin tokens, overlapping Chinese two-character terms, unique terms in first-seen order, semantic weight `0.65`, lexical weight `0.35`, and RRF `k = 60`. Keep ranking parameters in one exported `PHASE2_RANKING_V1` constant. Validate query limits `1..50` and 384 finite vector values.

- [ ] **Step 4: Write the hybrid-search migration**

The migration must:

1. enable `pg_trgm` in the `extensions` schema;
2. add `content_chunks.search_tokens text[] not null default '{}'` and its GIN index;
3. add a trigram index for active `files.display_name`;
4. validate `p_limit`, embedding dimensions, token count, token lengths, filters, and date ranges;
5. restrict semantic and lexical candidates to 50 each;
6. restrict candidates to the requested workspace, non-deleted files, and `current_version_id`;
7. fuse ranks with the approved RRF constants;
8. aggregate at file level and return at most three snippets with structured locations;
9. run as `security invoker`, rely on ordinary JWT RLS, and grant only to `authenticated`;
10. revoke from `public` and `anon` and avoid logging query input.

Use fully qualified schema references and do not reuse the Phase 0 `spike_chunks` table or `match_spike_chunks` function.

- [ ] **Step 5: Populate lexical terms during chunk publication**

Update `chunkRepository` so each inserted chunk stores `tokenizeLexical(chunk.content)`. Add a retry test proving the same version/chunk index receives the same ordered token array and that empty/punctuation-only terms produce an empty array rather than a null column.

- [ ] **Step 6: Add future SQL authorization and ranking tests but keep them UNRUN**

`phase2_hybrid_search_test.sql` covers non-member empty/denied results, member current-version results, deleted/old-version exclusion, filters, result caps, source locations, and cross-workspace isolation. Mark it UNRUN until a dedicated database target and ordinary JWT actors are authorized.

- [ ] **Step 7: Run the allowed local search checks**

Run:

```bash
pnpm --filter @knowledge-base/search-core test:unit
pnpm --filter @knowledge-base/contracts test:unit
```

Expected: PASS. Review the SQL migration statically; do not run it against any database and do not count static review as SQL behavior evidence.

- [ ] **Step 8: Suggested commit checkpoint, only if separately authorized**

```bash
git add packages/search-core packages/contracts supabase/migrations/20260810000200_phase2_hybrid_search.sql supabase/tests/phase2_hybrid_search_test.sql
git commit -m "feat: add phase-2 hybrid search foundation"
```

---

### Task 10: Add the Hermetic Phase 2 Gate, Evidence Boundary, and Handoff Documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/requirements/knowledge-base-implementation-roadmap.md`
- Create: `validation/phase-2/local-decision.md`

**Interfaces:**
- Consumes: all local tests and typechecks from Tasks 1–9.
- Produces: `pnpm verify:phase-2-local` and an evidence-backed local-only decision that cannot be confused with cloud or release evidence.

- [ ] **Step 1: Add the root local gate**

```json
{
  "scripts": {
    "verify:phase-2-local": "pnpm test && pnpm --filter @knowledge-base/search-core test:model && pnpm typecheck"
  }
}
```

Do not add cloud commands to this script. Review the script text as configuration, not as a behavior test.

- [ ] **Step 2: Run the complete approved local gate**

Run: `pnpm verify:phase-2-local`

Expected: exit code 0. Record the exact date, exit code, test-file count, test count, and typecheck result. If any layer fails, fix within its owning task and rerun the complete gate; do not record PASS from partial output.

- [ ] **Step 3: Run static repository checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Report all task files and preserve unrelated user changes.

- [ ] **Step 4: Update repository documentation without changing Phase 1's decision**

Update README structure, local commands, worker-only environment names, supported Phase 2 formats, and the no-cloud evidence boundary. Update the roadmap to mark the first Phase 2 sub-project `IN PROGRESS` or `LOCALLY VERIFIED` according to fresh evidence while leaving Phase 1 `NOT EVALUATED / NO-GO FOR RELEASE`. Record that the user explicitly approved the sequencing exception.

- [ ] **Step 5: Write the local decision record from observed output**

`validation/phase-2/local-decision.md` must include:

- decision date;
- exact commit/worktree state without creating a commit;
- exact local command, exit code, test counts, and typecheck result;
- fixture manifest checksums;
- supported formats and exclusions;
- explicit `UNRUN` rows for Supabase migrations, RLS search, Storage artifacts, cloud leases, real-question Recall@5, 5,000-file performance, and all remaining formats;
- conclusion `LOCALLY VERIFIED` only if the complete gate passed, otherwise `NOT EVALUATED` or `NO-GO` based on observed evidence;
- statement that Phase 2 overall and release remain blocked.

Never invent counts or convert static SQL source checks into database evidence.

- [ ] **Step 6: Request code review before any Git integration**

Use `superpowers:requesting-code-review` to compare implementation against the approved design and this plan. Resolve findings through the appropriate task owner, rerun the full local gate after fixes, and keep cloud gates UNRUN.

- [ ] **Step 7: Suggested final commit checkpoint, only if separately authorized**

```bash
git add package.json README.md docs/requirements/knowledge-base-implementation-roadmap.md validation/phase-2 docs/superpowers/specs/2026-08-10-phase-2-processing-pipeline-pdf-docx-design.md docs/superpowers/plans/2026-08-10-phase-2-processing-pipeline-pdf-docx.md
git commit -m "feat: add the phase-2 processing foundation"
```

Do not push or open a PR without a separate explicit instruction.

## Plan Completion Criteria

- Every task's focused local test cycle has fresh output.
- `pnpm verify:phase-2-local` passes in full with the cached model offline.
- The worker package contains no client-importable Service Role code.
- PDF and DOCX fixtures produce deterministic, locatable chunks.
- The local E5 provider produces exactly 384 finite values.
- Processing SQL source, future pgTAP gates, and cloud evidence remain clearly separated.
- Hybrid search core and SQL contract follow ordinary JWT/RLS boundaries.
- Phase 1 status is unchanged and Phase 2 overall is not marked complete.
- Git integration occurs only after explicit user authorization.

## Approved-Spec Coverage Check

- Decision, sequencing exception, local-only evidence boundary: Global Constraints and Task 10.
- Modular worker, credential separation, and explicit ports: Tasks 1 and 8.
- Versioned source locations and deterministic chunk indices: Tasks 1 and 6.
- Private artifacts, structured warnings, leases, retries, and atomic publication: Tasks 7 and 8.
- Native-text PDF pages and partial-page warnings: Task 4.
- DOCX paragraphs, headings, tables, and archive limits: Tasks 3 and 5.
- Offline 384-dimensional E5 passage/query embeddings: Task 2 and Task 8.
- Chinese/Latin lexical terms, weighted RRF, filename relevance, and file aggregation: Task 9.
- Ordinary-JWT/RLS search and current-version filtering: Task 9, with cloud execution explicitly UNRUN.
- Synthetic fixed samples, hermetic gate, evidence record, and remaining Phase 2 blockers: Tasks 3 and 10.
