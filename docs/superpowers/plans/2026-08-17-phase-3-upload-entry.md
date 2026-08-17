# Phase 3 Upload Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selected-workspace upload entry for one PDF or DOCX file.

**Architecture:** Keep upload validation and Supabase operations in a focused service, transient UI state in a hook, and rendering in a dedicated panel. `MainShell` receives the upload service by dependency injection so app-level tests can avoid real Supabase calls.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Supabase JS v2, Web Crypto.

## Global Constraints

- Do not commit or stage Git changes unless the user explicitly asks.
- Single-file upload only.
- Accepted MIME types: `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- Maximum size: `100000000` bytes.
- Storage bucket: `documents`.
- Server chain: `prepare_file_upload` → `createSignedUploadUrl` → `uploadToSignedUrl` → `mark_upload_complete`.
- Duplicate prepare result must not upload to Storage.

---

### Task 1: Upload service and validation

**Files:**
- Create: `apps/client/src/uploads/uploadService.ts`
- Test: `apps/client/src/uploads/uploadService.test.ts`

**Interfaces:**
- Produces: `validateUploadFile(file: File): string | null`
- Produces: `sha256Checksum(file: File): Promise<string>`
- Produces: `UploadService.uploadFile(input: UploadFileInput): Promise<UploadFileResult>`

- [ ] **Step 1: Write failing tests**

```ts
it('rejects unsupported file types before upload', () => {
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  expect(validateUploadFile(file)).toBe('仅支持 PDF 或 DOCX 文件');
});

it('formats sha256 checksums for upload RPCs', async () => {
  const file = new File(['abc'], 'a.pdf', { type: 'application/pdf' });
  await expect(sha256Checksum(file)).resolves.toBe(
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});
```

- [ ] **Step 2: Run failing tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/uploads/uploadService.test.ts`

Expected: FAIL because `uploadService.ts` does not exist.

- [ ] **Step 3: Implement minimal service**

Implement validation, checksum, prepare RPC, duplicate short-circuit, signed upload, and completion marking.

- [ ] **Step 4: Run tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/uploads/uploadService.test.ts`

Expected: PASS.

### Task 2: Upload queue hook and panel

**Files:**
- Create: `apps/client/src/uploads/useUploadQueue.ts`
- Create: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: `UploadService.uploadFile(input)`
- Produces: `UploadPanel` props `{ workspaceId: string; uploadService: UploadService }`

- [ ] **Step 1: Write failing app tests**

Add tests that a selected workspace shows an upload entry, unsupported files do not call the upload service, a PDF calls upload, and duplicate results show duplicate guidance.

- [ ] **Step 2: Run failing app tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: FAIL because upload UI/service injection does not exist.

- [ ] **Step 3: Implement hook and panel**

Render a file input with label `选择 PDF 或 DOCX` only when a current workspace exists. Keep state local to the panel.

- [ ] **Step 4: Run app tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: PASS.

### Task 3: Final local gate

**Files:**
- Modify only files from Tasks 1 and 2 if verification surfaces issues.

- [ ] **Step 1: Run focused tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx src/uploads/uploadService.test.ts`

- [ ] **Step 2: Run client typecheck**

Run: `env CI=true pnpm --dir apps/client typecheck`

- [ ] **Step 3: Run client build**

Run: `env CI=true pnpm --dir apps/client build`

- [ ] **Step 4: Review diff**

Run: `git status --short` and inspect changed files before reporting.

