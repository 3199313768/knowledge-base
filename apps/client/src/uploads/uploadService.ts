import { getSupabaseBrowserClient } from '../lib/supabaseClient';

const DOCUMENTS_BUCKET = 'documents';
export const MAX_UPLOAD_BYTES = 100000000;

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export interface UploadFileInput {
  file: File;
  workspaceId: string;
}

export type UploadFileResult =
  | {
      duplicateFileId: string;
      outcome: 'duplicate';
    }
  | {
      fileId: string;
      outcome: 'uploaded';
      versionId: string;
    };

export interface UploadService {
  uploadFile: (input: UploadFileInput) => Promise<UploadFileResult>;
}

interface PreparedUploadRow {
  duplicate_file_id: string | null;
  file_id: string | null;
  outcome: string;
  storage_path: string | null;
  version_id: string | null;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '上传失败';
}

function firstPreparedRow(data: unknown): PreparedUploadRow {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== 'object') {
    throw new Error('上传准备失败：服务端没有返回文件版本');
  }

  return row as PreparedUploadRow;
}

export function validateUploadFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return '仅支持 PDF 或 DOCX 文件';
  }

  if (file.size < 1) {
    return '文件不能为空';
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return '文件不能超过 100MB';
  }

  return null;
}

export async function sha256Checksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `sha256:${hex}`;
}

export const defaultUploadService: UploadService = {
  async uploadFile({ file, workspaceId }) {
    const validationError = validateUploadFile(file);
    if (validationError) {
      throw new Error(validationError);
    }

    const supabase = getSupabaseBrowserClient();
    const checksum = await sha256Checksum(file);
    const { data, error } = await supabase.rpc('prepare_file_upload', {
      p_checksum: checksum,
      p_display_name: file.name,
      p_mime_type: file.type,
      p_size_bytes: file.size,
      p_workspace_id: workspaceId
    });

    if (error) {
      throw new Error(messageFrom(error));
    }

    const prepared = firstPreparedRow(data);

    if (prepared.outcome === 'duplicate') {
      if (!prepared.duplicate_file_id) {
        throw new Error('重复文件缺少文件 ID');
      }

      return {
        duplicateFileId: prepared.duplicate_file_id,
        outcome: 'duplicate'
      };
    }

    if (
      prepared.outcome !== 'created' ||
      !prepared.file_id ||
      !prepared.version_id ||
      !prepared.storage_path
    ) {
      throw new Error('上传准备失败：服务端返回无效');
    }

    const { data: signedUpload, error: signError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(prepared.storage_path, { upsert: false });

    if (signError) {
      throw new Error(messageFrom(signError));
    }

    if (!signedUpload?.token) {
      throw new Error('上传签名缺失');
    }

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .uploadToSignedUrl(prepared.storage_path, signedUpload.token, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      throw new Error(messageFrom(uploadError));
    }

    const { error: completeError } = await supabase.rpc('mark_upload_complete', {
      p_version_id: prepared.version_id
    });

    if (completeError) {
      throw new Error(messageFrom(completeError));
    }

    return {
      fileId: prepared.file_id,
      outcome: 'uploaded',
      versionId: prepared.version_id
    };
  }
};
