import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';

const processingWorkerRequire = createRequire(
  new URL('../../apps/processing-worker/package.json', import.meta.url)
);
const PDFDocument = processingWorkerRequire('pdfkit') as PdfDocumentConstructor;
const YazlZipFile = processingWorkerRequire('yazl').ZipFile as YazlZipFileConstructor;

const fixedDate = new Date('2020-01-02T03:04:05.000Z');
const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const oversizedEntryBytes = 50_000_001;
const nativeTextFontPath = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const pinnedNativeTextFontSha256 =
  '876af2cd4854644e7f3e7feb2f688997fdb3343c6df6693611209c9dfb47ccec';

export interface FixtureRecord {
  filename: string;
  purpose: string;
  mime: string;
  byteSize: number;
  sha256: string;
}

export interface FixtureManifest {
  schemaVersion: 1;
  files: FixtureRecord[];
}

interface FixtureContents {
  filename: string;
  purpose: string;
  mime: string;
  bytes: Buffer;
}

export interface FixtureGenerationOptions {
  nativeTextFontPath?: string;
  nativeTextFontSha256?: string;
}

export async function generateFixtures(
  destination: string,
  options: FixtureGenerationOptions = {}
): Promise<FixtureManifest> {
  const nativeTextFont = await readPinnedNativeTextFont(options);
  const filesDirectory = join(destination, 'files');
  await mkdir(filesDirectory, { recursive: true });

  const fixtures: FixtureContents[] = [
    {
      filename: 'native-text.pdf',
      purpose: 'Three pages of bilingual native PDF text, with an empty second page.',
      mime: 'application/pdf',
      bytes: await createBilingualPdf(nativeTextFont)
    },
    {
      filename: 'empty.pdf',
      purpose: 'A zero-byte PDF upload used to exercise empty-file validation.',
      mime: 'application/pdf',
      bytes: Buffer.alloc(0)
    },
    {
      filename: 'encrypted.pdf',
      purpose: 'A password-protected PDF used to exercise encrypted-file handling.',
      mime: 'application/pdf',
      bytes: await createPdf(['Encrypted fixture / 加密样例'], {
        userPassword: 'fixture-user-password',
        ownerPassword: 'fixture-owner-password'
      })
    },
    {
      filename: 'corrupt.pdf',
      purpose: 'Malformed bytes declared as a PDF.',
      mime: 'application/pdf',
      bytes: Buffer.from('not a PDF fixture', 'utf8')
    },
    {
      filename: 'paragraphs-and-table.docx',
      purpose: 'DOCX with one heading, two paragraphs, and a three-row table.',
      mime: docxMime,
      bytes: await createDocx({ includeContent: true })
    },
    {
      filename: 'empty.docx',
      purpose: 'Structurally valid DOCX with an empty document body.',
      mime: docxMime,
      bytes: await createDocx({ includeContent: false })
    },
    {
      filename: 'corrupt.docx',
      purpose: 'Malformed bytes declared as a DOCX.',
      mime: docxMime,
      bytes: Buffer.from('PK\u0003\u0004corrupt fixture', 'binary')
    },
    {
      filename: 'oversized-entry.docx',
      purpose: 'DOCX ZIP with a compressed entry declaring more than 50 MB expanded.',
      mime: docxMime,
      bytes: await createOversizedDocx()
    },
    {
      filename: 'pdf-named-as-docx.docx',
      purpose: 'PDF content carrying a DOCX filename for byte-signature checks.',
      mime: docxMime,
      bytes: await createPdf(['The filename is intentionally misleading.'])
    }
  ];

  await Promise.all(
    fixtures.map(async (fixture) => {
      await writeFile(join(filesDirectory, fixture.filename), fixture.bytes);
    })
  );

  const manifest: FixtureManifest = {
    schemaVersion: 1,
    files: fixtures.map(({ filename, purpose, mime, bytes }) => ({
      filename,
      purpose,
      mime,
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }))
  };
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function readPinnedNativeTextFont(options: FixtureGenerationOptions): Promise<Buffer> {
  try {
    const bytes = await readFile(options.nativeTextFontPath ?? nativeTextFontPath);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== (options.nativeTextFontSha256 ?? pinnedNativeTextFontSha256)) {
      throw fixtureGenerationFailure();
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message === 'Pinned native-text font verification failed.') {
      throw error;
    }
    throw fixtureGenerationFailure();
  }
}

export async function verifyFixtureCorpus(
  corpusDirectory: string,
  manifest: FixtureManifest
): Promise<void> {
  try {
    const expectedFilenames = new Set(manifest.files.map((fixture) => fixture.filename));
    const actualFilenames = new Set(await readdir(join(corpusDirectory, 'files')));
    if (
      expectedFilenames.size !== manifest.files.length ||
      actualFilenames.size !== expectedFilenames.size ||
      [...actualFilenames].some((filename) => !expectedFilenames.has(filename))
    ) {
      throw fixtureCorpusFailure();
    }
    for (const fixture of manifest.files) {
      const bytes = await readFile(join(corpusDirectory, 'files', fixture.filename));
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (bytes.byteLength !== fixture.byteSize || checksum !== fixture.sha256) {
        throw fixtureCorpusFailure();
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Fixture corpus verification failed.') {
      throw error;
    }
    throw fixtureCorpusFailure();
  }
}

async function createPdf(
  pages: string[],
  encryption?: { userPassword: string; ownerPassword: string },
  fontSource?: string | Buffer
): Promise<Buffer> {
  const document = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: 'Knowledge Base Synthetic Processing Fixture',
      Author: 'knowledge-base',
      CreationDate: fixedDate,
      ModDate: fixedDate
    },
    ...encryption
  });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.once('end', () => resolve(Buffer.concat(chunks)));
    output.once('error', reject);
    document.once('error', reject);
  });
  document.pipe(output);
  for (const page of pages) {
    document.addPage();
    if (page) {
      document.font(fontSource ?? 'Helvetica').fontSize(12).text(page);
    }
  }
  document.end();
  return completed;
}

async function createBilingualPdf(fontBytes: Buffer): Promise<Buffer> {
  const firstPageText = 'Phase 2 processing fixture / 处理管线样例';
  const thirdPageText = '第三页：安全、可复现、可验证。';
  return createPdf([firstPageText, '', thirdPageText], undefined, fontBytes);
}

function fixtureCorpusFailure(): Error {
  return new Error('Fixture corpus verification failed.');
}

function fixtureGenerationFailure(): Error {
  return new Error('Pinned native-text font verification failed.');
}

async function createDocx({ includeContent }: { includeContent: boolean }): Promise<Buffer> {
  const zip = new YazlZipFile();
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.once('error', reject);
  });

  zip.addBuffer(Buffer.from(contentTypesXml), '[Content_Types].xml', { mtime: fixedDate });
  zip.addBuffer(Buffer.from(rootRelationshipsXml), '_rels/.rels', { mtime: fixedDate });
  zip.addBuffer(
    Buffer.from(includeContent ? populatedDocumentXml : emptyDocumentXml),
    'word/document.xml',
    { mtime: fixedDate }
  );
  zip.end();
  return finished;
}

async function createOversizedDocx(): Promise<Buffer> {
  const bytes = await createDocx({ includeContent: true });
  const centralDirectorySignature = 0x02014b50;
  const localHeaderSignature = 0x04034b50;
  const entryName = Buffer.from('word/document.xml');

  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== centralDirectorySignature) continue;
    const filenameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const filename = bytes.subarray(offset + 46, offset + 46 + filenameLength);
    if (filename.equals(entryName)) {
      bytes.writeUInt32LE(oversizedEntryBytes, offset + 24);
      const localHeaderOffset = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(localHeaderOffset) !== localHeaderSignature) {
        throw new Error('fixture archive layout is invalid');
      }
      bytes.writeUInt32LE(oversizedEntryBytes, localHeaderOffset + 22);
      return bytes;
    }
    offset += 46 + filenameLength + extraLength + commentLength - 1;
  }
  throw new Error('fixture archive entry was not found');
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const emptyDocumentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;

const populatedDocumentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Processing Fixture Heading</w:t></w:r></w:p>
    <w:p><w:r><w:t>First synthetic paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second synthetic paragraph.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Row one</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Row two</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

interface PdfDocument {
  addPage(): void;
  end(): void;
  font(source: string | Buffer): PdfDocument;
  fontSize(size: number): PdfDocument;
  once(event: 'error', listener: (error: Error) => void): PdfDocument;
  pipe(destination: PassThrough): void;
  text(text: string): PdfDocument;
}

interface PdfDocumentConstructor {
  new (options: {
    autoFirstPage: boolean;
    info: {
      Title: string;
      Author: string;
      CreationDate: Date;
      ModDate: Date;
    };
    userPassword?: string;
    ownerPassword?: string;
  }): PdfDocument;
}

interface YazlZipFile {
  outputStream: Readable;
  addBuffer(buffer: Buffer, metadataPath: string, options: { mtime: Date }): void;
  end(): void;
}

interface YazlZipFileConstructor {
  new (): YazlZipFile;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) {
    throw new Error('A fixture output directory is required.');
  }
  void generateFixtures(resolve(destination)).catch((error: unknown) => {
    process.exitCode = 1;
    throw error;
  });
}
