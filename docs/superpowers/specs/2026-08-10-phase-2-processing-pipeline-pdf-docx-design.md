# Phase 2 Processing Pipeline and PDF/DOCX Search Foundation Design

- Date: 2026-08-10
- Status: approved in section-by-section product review
- Parent specification: `docs/requirements/knowledge-base-app-design.md`
- Roadmap stage: Phase 2, first independently verifiable sub-project

## 1. Decision and evidence boundary

This design starts Phase 2 with a local Node.js processing worker, native-text PDF and DOCX extraction, deterministic chunking, local embeddings, and the backend contract for hybrid search.

The user explicitly approved entering Phase 2 before the Phase 1 runtime gate has been executed. This is a sequencing exception, not a change to the Phase 1 decision. `validation/phase-1/decision.md` remains `NOT EVALUATED / NO-GO FOR RELEASE`, and Phase 2 implementation must not be used as evidence that Phase 1 authorization, Storage, migration rebuild, or cleanup gates passed.

The approved verification boundary for this sub-project is:

- local unit and integration tests that do not connect to Supabase;
- TypeScript type checking;
- the already cached `multilingual-e5-small` model, with network downloads disabled;
- no real Supabase processing run, cloud mutation, or cloud authorization test.

Consequently, this sub-project may eventually be described as locally verified, but Phase 2 as a whole cannot be marked complete or releasable from local evidence alone.

## 2. Goals

The sub-project must:

1. create a modular `apps/processing-worker` Node.js application;
2. process native-text PDF and DOCX files into normalized, locatable blocks;
3. split blocks deterministically without losing source locations;
4. generate 384-dimensional embeddings with the pinned local `multilingual-e5-small` model;
5. write idempotent content chunks for a non-current processing version;
6. advance processing stages without leaving gaps between one completed stage and the next pending stage;
7. publish a successful or partially successful version atomically;
8. define a user-scoped hybrid-search database contract using semantic and lexical retrieval;
9. provide a local gate covering parsing, chunking, embeddings, ranking, safety, and types.

## 3. Non-goals

This sub-project does not include:

- scanned-PDF or image OCR;
- webpage snapshotting;
- PPTX, XLSX, JPG/JPEG, PNG, or HEIC extraction;
- a cloud-hosted worker or worker deployment pipeline;
- a public HTTP search service or product search UI;
- Mac or iPhone upload, status, search, preview, or administration UI;
- the Phase 2 real-question quality gate;
- Phase 1 cloud verification;
- AI answers, summaries, rewriting, chat, or any other capability excluded by the frozen product specification.

## 4. Architecture

The worker is a modular monolith. One Node.js process owns orchestration while pure processing modules remain independent of Supabase.

```text
claim job -> download -> validate -> extract -> normalize -> chunk
          -> embed -> write chunks -> finalize version -> clean artifacts
```

### 4.1 Application modules

`apps/processing-worker` contains these boundaries:

- `jobs`: claim, heartbeat, stage completion, retry, finalization, and graceful shutdown;
- `storage`: original-file download and private processing-artifact access;
- `validation`: size, MIME, magic-byte, encryption, archive, and format validation;
- `extractors`: a registry plus independent PDF and DOCX adapters;
- `normalize`: conversion from adapter output to the shared normalized-block contract;
- `chunking`: deterministic source-boundary-aware splitting;
- `embeddings`: the pinned local E5 provider and batching;
- `publisher`: idempotent writes to `content_chunks` and final publication;
- `search`: lexical tokenization, result fusion, file aggregation, and evaluation helpers;
- `runner`: the local long-running CLI loop and bounded one-shot execution.

The extractor, normalization, chunking, embedding contract, tokenization, ranking, and aggregation modules must not import Supabase clients. Infrastructure adapters implement explicit interfaces around those pure modules.

### 4.2 Credential boundary

The Service Role key is allowed only in the worker process and future trusted worker deployment. It must never enter the Tauri/React client, fixture files, logs, reports, or committed environment files.

User searches use an ordinary authenticated JWT and database RLS. Service Role must not be used to prove search or workspace isolation.

## 5. Shared data contracts

The shared contracts live in `packages/contracts` so the worker, database mapping, evaluator, and future clients do not invent incompatible location formats.

```ts
export interface NormalizedBlock {
  index: number;
  type: 'paragraph' | 'table';
  text: string;
  location: SourceLocation;
}

export interface ChunkDraft {
  index: number;
  content: string;
  sourceLocation: SourceLocation;
}

export type SourceLocation =
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
```

Contract rules:

- indices and PDF page numbers are one-based except `ChunkDraft.index`, which is a zero-based stable storage ordinal;
- PDF chunks never span pages;
- DOCX blocks follow document order;
- paragraph locations use a paragraph range and may carry a heading path;
- table locations use a table number and row range;
- `label` is a short user-facing location string derived from the structured fields;
- empty paragraphs, decorative-only content, and images without text do not produce blocks;
- splitting may narrow a location but may not remove or invent one;
- every persisted location has `schemaVersion: 1` and passes both TypeScript validation and a database-side JSON validator.

## 6. Database and private artifact changes

A Phase 2 migration extends `content_chunks` with:

- `chunk_index integer not null` after a deterministic per-version backfill;
- `search_tokens text[] not null` for normalized lexical terms;
- a unique constraint on `(version_id, chunk_index)`;
- a GIN index on `search_tokens`;
- a database-side source-location validator.

The backfill orders existing chunks by `created_at, id` within each version. It does not treat historical Phase 0 spike rows as production chunks.

`processing_jobs` gains:

- `worker_id text`;
- `lease_expires_at timestamptz`;
- the indexes needed to claim pending work and recover expired leases.

Structured partial-processing warnings are stored in an append-only `processing_warnings` table with `id`, `version_id`, `stage`, `code`, optional `source_location`, and `created_at`. Workspace members may read warnings for versions they can read through RLS; only Service Role may insert them, and no caller may update them. A warning never contains extracted body text or a raw third-party/parser exception.

A private `processing-artifacts` Storage bucket holds compressed, versioned intermediate data:

```text
processing/{workspace_id}/{version_id}/normalized-v1.json.gz
processing/{workspace_id}/{version_id}/chunks-v1.json.gz
```

Only Service Role can read or write this bucket. Authenticated and anonymous clients receive no bucket policies. Successful publication or final failure triggers immediate best-effort deletion; a worker sweeper retries deletion by exact version prefix. The existing `cleanup` processing stage retains its Phase 1 meaning for deleted files and is not overloaded for artifact cleanup.

## 7. Processing stages

### 7.1 Validate

The worker checks the stored size, magic bytes, declared MIME, actual format, encryption state, and container safety. Only native-text PDF and DOCX proceed in this sub-project.

### 7.2 Extract

PDF extraction emits page-scoped blocks. DOCX extraction emits ordered paragraph and table blocks. The normalized result is written to `normalized-v1.json.gz`.

### 7.3 Chunk

Chunking uses page, paragraph, table, and bounded-length boundaries. The same normalized input and the same versioned chunking configuration must produce identical chunk indices, text, and locations. Drafts are written to `chunks-v1.json.gz`.

### 7.4 Embed

The worker reads chunk drafts, batches passage embeddings, verifies every vector has 384 finite values, and replaces unpublished chunks for the version. A retry first removes that version's incomplete chunk set and then rebuilds it. Current published-version chunks remain immutable.

### 7.5 Finalize

Finalization verifies terminal required stages, chunk count, source-location validity, vector dimensions, and warning state. Completing the final job and switching `files.current_version_id` occur in one database transaction. A failed replacement preserves the old current version.

### 7.6 OCR

No OCR job is created for this sub-project. Scanned PDFs receive a stable unsupported-for-current-subproject result and are handled by a later OCR design cycle.

## 8. Job atomicity, leases, and retries

Worker-only RPCs extend the Phase 1 state machine:

- claiming a job records `worker_id`, increments the attempt, and sets a bounded lease;
- a heartbeat may extend only the lease owned by that worker;
- completing a stage and inserting the next pending stage happen atomically;
- completing the final stage and finalizing the file version happen atomically;
- an expired lease can be reclaimed when the retry budget remains;
- stale workers cannot complete or heartbeat a lease now owned by another worker;
- `(version_id, stage)` remains unique;
- `(version_id, chunk_index)` prevents duplicate chunks.

Transient failures allow at most three claimed attempts in total: the first attempt is immediate, the second starts after 30 seconds, and the third starts after 2 minutes. After the third failure the job becomes terminal; no unused fourth-attempt delay is recorded. Permanent validation or parsing failures do not auto-retry. An explicitly authorized user may still request manual reprocessing through the existing product flow when the underlying cause has changed.

No transition may leave a successful stage without either its successor, a terminal failed version, or a published version in the same transaction.

## 9. PDF and DOCX extraction behavior

### 9.1 PDF

- extract native text in page order;
- preserve one-based page numbers;
- do not merge chunks across pages;
- do not fetch embedded or referenced network resources;
- identify encrypted, corrupt, empty-text, and likely scanned documents distinctly;
- allow partially searchable publication only when at least one reliable page produced valid chunks and failed pages are recorded as structured warnings.

### 9.2 DOCX

- parse paragraphs and tables in document order;
- preserve heading paths when the document structure exposes them;
- convert table cells into readable search text while retaining table and row positions;
- reject unsafe ZIP paths, external entities, and external-resource access;
- enforce at most 10,000 archive entries, 500 MB total expanded data, and 50 MB per entry;
- treat a wholly unreadable document as failed rather than publishing noise.

## 10. Embedding provider

The default and only implemented provider in this sub-project is the pinned local `multilingual-e5-small` model already used by Phase 0.

Requirements:

- dimensions are exactly 384;
- passages and queries use the model's distinct passage/query encoding conventions;
- the model revision and expected local files/checksums are pinned;
- test and worker startup do not silently download a different revision;
- extracted text is not sent to a third-party generative AI or embedding API;
- model-load and inference failures use stable error codes without logging input text.

## 11. Hybrid search

The sub-project defines a backend search contract but no product UI.

```ts
export interface SearchQuery {
  workspaceId: string;
  text: string;
  embedding: number[];
  filters?: {
    fileTypes?: string[];
    uploaderIds?: string[];
    updatedFrom?: string;
    updatedTo?: string;
  };
  limit: number;
}
```

`limit` is restricted to `1..50`, and `embedding` must contain 384 finite values. A trusted backend component generates the query vector; the future product client does not own the model or Service Role credentials.

### 11.1 Lexical normalization

- Chinese text produces overlapping two-character terms;
- Latin words and numbers are Unicode-normalized and lowercased;
- punctuation-only and empty terms are removed;
- filenames additionally support exact, contained, and trigram matches.

The same versioned tokenizer implementation is used for indexed chunk terms and query terms.

### 11.2 Candidate retrieval and fusion

Semantic retrieval selects the best 50 chunks by cosine similarity. Lexical retrieval selects the best 50 chunks by normalized term and filename relevance. The two ranked lists are fused using Reciprocal Rank Fusion:

```text
semantic weight = 0.65
lexical weight  = 0.35
RRF k           = 60
```

These are initial versioned parameters, not timeless constants. They may change only with recorded fixed-evaluation evidence.

### 11.3 File aggregation

- only non-deleted files and their `current_version_id` chunks are candidates;
- multiple chunk hits aggregate into one file result;
- the best chunk dominates the file score and a second chunk provides only a bounded supplement;
- at most three explanatory chunks are returned per file;
- an exact filename hit receives a bounded boost;
- recency is a tie-breaker and cannot override a clearly more relevant file;
- filters are applied before final ranking.

### 11.4 Authorization

The search database function runs with an ordinary authenticated JWT and RLS. It verifies membership, workspace, non-deleted file state, and current-version identity in SQL. It caps candidate and result counts and does not log query text, query vectors, or result bodies. No-result searches return an empty list and never generate or guess an answer.

## 12. Error model

### 12.1 Permanent errors

- `unsupported_type`
- `mime_mismatch`
- `encrypted_file`
- `corrupt_file`
- `empty_content`
- `ocr_required`
- `unsafe_archive`

Permanent errors do not auto-retry and lead to a failed new version without replacing the old current version.

### 12.2 Transient errors

- `storage_download_failed`
- `artifact_io_failed`
- `model_load_failed`
- `embedding_failed`
- `database_write_failed`
- `worker_timeout`

Transient errors use the bounded retry schedule in Section 8.

### 12.3 Partial success

`partially_searchable` is allowed only when:

- at least one non-empty, reliable chunk exists;
- every persisted chunk has a valid location and 384-dimensional vector;
- failures affect only part of a PDF or recoverable DOCX structure;
- affected positions are recorded as structured warnings;
- all required jobs are terminal.

A document that cannot be reliably interpreted is failed rather than published with misleading fragments.

## 13. Security and observability

- actual file type is detected after download;
- archive path traversal, XML external entities, and external resource fetching are prohibited;
- PDF parsing cannot make network requests;
- jobs have cancellation, time, and memory boundaries;
- logs contain only workspace/file/version identifiers, stage, duration, stable code, and counts;
- logs contain no body text, query text, OTP, secret, signed URL, raw parser exception, or vector;
- processing artifacts are private, version-scoped, and deleted by exact prefix;
- the local model is version- and checksum-pinned;
- worker shutdown stops claiming, finishes or releases the current lease safely, and then exits.

## 14. Local verification

Versioned, non-sensitive fixtures include:

- a three-page bilingual native-text PDF with an empty page;
- a DOCX with headings, paragraphs, and a table;
- empty, corrupt, and encrypted PDFs;
- empty and corrupt DOCX files;
- mismatched extension/MIME/content files;
- an unsafe DOCX archive;
- long paragraphs and large tables for chunk boundaries.

Local verification covers:

- parser output order and location snapshots;
- empty-page, paragraph, table, and boundary behavior;
- deterministic chunk indices, content, and locations;
- stable handling of corrupt, encrypted, disguised, and unsafe inputs;
- cached model loading with network access disabled;
- 384-dimensional finite embeddings;
- Chinese and Latin tokenization;
- RRF, filename boost, file aggregation, filters, and no-result behavior;
- lease ownership and pure transition decisions using repository adapters/fakes;
- TypeScript type checking across the worker and shared contracts.

The root local gate is:

```bash
pnpm verify:phase-2-local
```

It must not read Supabase credentials, create a Supabase client, or access the network.

## 15. Completion criteria

This sub-project is locally complete only when:

- PDF and DOCX fixtures reliably produce locatable normalized blocks;
- chunking is deterministic and source-preserving;
- the cached model produces valid 384-dimensional vectors;
- job orchestration, error classification, leases, retries, and publication behavior are implemented;
- hybrid-search core algorithms and contracts are implemented;
- all approved local tests and type checks pass with fresh output.

The following remain explicitly unevaluated and block a Phase 2 completion or release claim:

- a real Supabase worker run from upload through publication;
- ordinary-JWT search and cross-workspace isolation;
- migration replay and private processing-artifact policies;
- cloud lease contention and worker-crash recovery;
- 30–50 real questions with `Recall@5 >= 80%`;
- parsing regression coverage for the remaining frozen formats;
- the 5,000-file performance target;
- Phase 1's outstanding runtime gates.

## 16. Follow-on Phase 2 sub-projects

After this foundation, Phase 2 continues through separate design, plan, implementation, and verification cycles:

1. OCR for images and scanned PDFs;
2. PPTX and XLSX adapters;
3. safe webpage snapshotting;
4. dedicated cloud worker deployment and full Supabase processing verification;
5. the 30–50-question retrieval-quality evaluation and tuning cycle;
6. the 5,000-file performance cycle.

Phase 3 client implementation remains separate.

## 17. Approved decisions

- Start with the processing-pipeline foundation rather than search-first or all-format parallel work.
- Run the first worker locally.
- Support native-text PDF and DOCX paragraphs/tables first.
- Reuse local `multilingual-e5-small` at 384 dimensions.
- Deliver a backend-only closure without product UI.
- Permit local tests and TypeScript checking but no cloud verification.
- Use a modular-monolith worker architecture.
- Preserve Phase 1's existing evidence decision while proceeding under an explicit user-approved sequencing exception.
