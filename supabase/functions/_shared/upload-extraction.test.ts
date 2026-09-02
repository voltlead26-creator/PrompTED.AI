// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  extractBoundedUploadText,
  MAX_TEXT_UPLOAD_BYTES,
  resolveUploadFormat,
  UPLOAD_RESOURCE_POLICY_VERSION,
  UploadExtractionError,
} from "./upload-extraction.ts";

interface ZipFixtureEntry {
  name: string;
  data?: Uint8Array;
  compressedData?: Uint8Array;
  method?: 0 | 8;
  declaredUncompressedSize?: number;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (
    let start = 0;
    start <= haystack.length - needle.length;
    start += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

function storedZip(entries: ZipFixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data ?? new Uint8Array();
    const archiveData = entry.compressedData ?? data;
    const method = entry.method ?? 0;
    const declared = entry.declaredUncompressedSize ?? data.byteLength;
    const local = new Uint8Array(30 + name.byteLength + archiveData.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc32(data), true);
    localView.setUint32(18, archiveData.byteLength, true);
    localView.setUint32(22, declared, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(archiveData, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc32(data), true);
    centralView.setUint32(20, archiveData.byteLength, true);
    centralView.setUint32(24, declared, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.byteLength;
  }

  const centralBytes = concatBytes(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true);
  endView.setUint32(16, localOffset, true);
  return concatBytes([...locals, centralBytes, end]);
}

const encoder = new TextEncoder();
const DOCX_CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";
const XLSX_CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  "</Types>";

function rootRelationships(target: string): string {
  return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>` +
    "</Relationships>";
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function docxEntries(
  body = "Reliable document text",
  extras: ZipFixtureEntry[] = [],
): ZipFixtureEntry[] {
  return [
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("word/document.xml")),
    },
    {
      name: "word/document.xml",
      data: encoder.encode(
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>' + body +
          "</w:t></w:r></w:p></w:body></w:document>",
      ),
    },
    ...extras,
  ];
}

function minimalDocx(
  body = "Reliable document text",
  extras: ZipFixtureEntry[] = [],
): Uint8Array {
  return storedZip(docxEntries(body, extras));
}

function minimalXlsx(): Uint8Array {
  return storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(XLSX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("xl/workbook.xml")),
    },
    {
      name: "xl/workbook.xml",
      data: encoder.encode(
        '<workbook xmlns:r="urn:r"><sheets>' +
          '<sheet name="Visible" sheetId="1" r:id="rId1"/>' +
          '<sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>' +
          "</sheets></workbook>",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(
        '<Relationships xmlns="urn:r">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Visible value</t></is></c></row></sheetData></worksheet>',
      ),
    },
    {
      name: "xl/worksheets/sheet2.xml",
      data: encoder.encode(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>HIDDEN SENTINEL</t></is></c></row></sheetData></worksheet>',
      ),
    },
  ]);
}

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

Deno.test("upload format identity is content-led and rejects conflicting metadata", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic");
  assertEquals(
    await resolveUploadFormat(pdf, "source.pdf", "application/pdf"),
    "pdf",
  );
  await assertRejects(
    () => resolveUploadFormat(pdf, "source.docx", "application/pdf"),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
  await assertRejects(
    () => resolveUploadFormat(pdf, "source", "application/pdf"),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );

  const legacyOle = Uint8Array.from([
    0xd0,
    0xcf,
    0x11,
    0xe0,
    0xa1,
    0xb1,
    0x1a,
    0xe1,
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(legacyOle, "legacy.xls", "application/vnd.ms-excel"),
    UploadExtractionError,
    "UPLOAD_LEGACY_FORMAT_UNSUPPORTED",
  );

  assertEquals(
    await resolveUploadFormat(
      encoder.encode("name,value\nTED,reliable"),
      "source.csv",
      "application/vnd.ms-excel",
    ),
    "text",
  );
  assertEquals(
    await resolveUploadFormat(
      encoder.encode("# Reliable"),
      "source.md",
      "application/markdown",
    ),
    "text",
  );
  await assertRejects(
    () =>
      resolveUploadFormat(
        encoder.encode("not a spreadsheet"),
        "source.txt",
        "application/vnd.ms-excel",
      ),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
  await assertRejects(
    () =>
      resolveUploadFormat(
        encoder.encode("extension required"),
        "source",
        "text/plain",
      ),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
});

Deno.test("Office archives are classified only after bounded entry inspection", async () => {
  const docx = minimalDocx();
  assertEquals(
    await resolveUploadFormat(
      docx,
      "letter.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "docx",
  );

  const traversal = storedZip([
    { name: "[Content_Types].xml" },
    { name: "word/document.xml" },
    { name: "../escape.xml" },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(traversal, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_PATH_INVALID",
  );

  const macro = storedZip([
    { name: "[Content_Types].xml" },
    { name: "xl/workbook.xml" },
    { name: "xl/vbaProject.bin" },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(macro, "workbook.xlsx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ACTIVE_CONTENT_UNSUPPORTED",
  );
});

Deno.test("DOCX and XLSX extraction follows only package-reachable visible content", async () => {
  const docx = minimalDocx("Reachable text", [
    {
      name: "word/header1.xml",
      data: encoder.encode(
        '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>UNREFERENCED HEADER</w:t></w:r></w:p></w:hdr>',
      ),
    },
  ]);
  const docxResult = await extractBoundedUploadText(
    docx,
    "letter.docx",
    "application/zip",
  );
  assertEquals(docxResult.format, "docx");
  assert(docxResult.text.includes("Reachable text"));
  assertEquals(docxResult.text.includes("UNREFERENCED HEADER"), false);

  const xlsxResult = await extractBoundedUploadText(
    minimalXlsx(),
    "workbook.xlsx",
    "application/x-zip-compressed",
  );
  assertEquals(xlsxResult.format, "xlsx");
  assert(xlsxResult.text.includes("Visible value"));
  assertEquals(xlsxResult.text.includes("HIDDEN SENTINEL"), false);
});

Deno.test("deflated Office entries verify CRC while enforcing the declared streaming ceiling", async () => {
  const entries = await Promise.all(
    docxEntries("Deflated reliable text").map(
      async (entry): Promise<ZipFixtureEntry> => {
        const data = entry.data ?? new Uint8Array();
        return {
          ...entry,
          method: 8,
          compressedData: await deflateRaw(data),
        };
      },
    ),
  );
  const result = await extractBoundedUploadText(
    storedZip(entries),
    "letter.docx",
    "application/octet-stream",
  );
  assert(result.text.includes("Deflated reliable text"));

  const expanded = encoder.encode("A".repeat(100_000));
  const expansionBomb = storedZip([
    ...docxEntries().slice(0, 2),
    {
      name: "word/document.xml",
      data: expanded,
      compressedData: await deflateRaw(expanded),
      method: 8,
      declaredUncompressedSize: 100,
    },
  ]);
  const failure = await assertRejects(
    () =>
      resolveUploadFormat(
        expansionBomb,
        "letter.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
  assertEquals(failure.status, 413);
});

Deno.test("Office archive CRC, canonical names, entities, and external relationships fail closed", async () => {
  const damaged = minimalDocx();
  const textOffset = indexOfBytes(
    damaged,
    encoder.encode("Reliable document text"),
  );
  assert(textOffset >= 0);
  damaged[textOffset] ^= 0x01;
  await assertRejects(
    () =>
      resolveUploadFormat(damaged, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );

  const duplicate = storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("word/document.xml")),
    },
    { name: "word/document.xml", data: encoder.encode("<x/>") },
    { name: "WORD/DOCUMENT.XML", data: encoder.encode("<x/>") },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(duplicate, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_DUPLICATE_PATH",
  );

  const invalidEntity = minimalDocx("&#x110000;");
  await assertRejects(
    () =>
      extractBoundedUploadText(
        invalidEntity,
        "letter.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_OFFICE_XML_INVALID",
  );

  const external = storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/document.xml" TargetMode="External"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: encoder.encode('<w:document xmlns:w="urn:w"/>'),
    },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(external, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_OFFICE_EXTERNAL_RELATIONSHIP_UNSUPPORTED",
  );
});

Deno.test("declared or actual archive expansion cannot exceed the resource policy", async () => {
  const oversized = storedZip([
    { name: "[Content_Types].xml" },
    {
      name: "word/document.xml",
      declaredUncompressedSize: 32 * 1024 * 1024,
    },
  ]);
  const error = await assertRejects(
    () =>
      resolveUploadFormat(oversized, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "UPLOAD_ARCHIVE_EXPANSION_LIMIT");
});

Deno.test("plain-text parsing is fatal UTF-8, byte bounded, and output bounded", async () => {
  const text = new TextEncoder().encode("Reliable text\n".repeat(3_000));
  const result = await extractBoundedUploadText(
    text,
    "notes.txt",
    "text/plain",
  );
  assertEquals(result.format, "text");
  assertEquals(result.resourcePolicyVersion, UPLOAD_RESOURCE_POLICY_VERSION);
  assert(result.text.length <= 20_000);
  assert(result.truncated);

  const oversized = new Uint8Array(MAX_TEXT_UPLOAD_BYTES + 1).fill(0x61);
  const error = await assertRejects(
    () => extractBoundedUploadText(oversized, "notes.txt", "text/plain"),
    UploadExtractionError,
    "UPLOAD_TEXT_RESOURCE_LIMIT",
  );
  assertEquals(error.status, 413);
});

Deno.test("PDF extraction source is sequential and has no eager all-pages fan-out", async () => {
  const source = await Deno.readTextFile(
    new URL("./upload-extraction.ts", import.meta.url),
  );
  assert(
    source.includes(
      "for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1)",
    ),
  );
  assert(!source.includes("Promise.all"));
});

Deno.test("PDF extraction is behavioral, bounded, and maps malformed input deterministically", async () => {
  const result = await extractBoundedUploadText(
    minimalPdf("Reliable PDF text"),
    "source.pdf",
    "application/pdf",
  );
  assertEquals(result.format, "pdf");
  assert(result.text.includes("Reliable PDF text"));

  const malformed = await assertRejects(
    () =>
      extractBoundedUploadText(
        encoder.encode("%PDF-1.7\nnot a valid PDF"),
        "source.pdf",
        "application/pdf",
      ),
    UploadExtractionError,
  );
  assertEquals(malformed.status, 422);
  assertEquals(malformed.code, "UPLOAD_PDF_INVALID");

  const controller = new AbortController();
  controller.abort();
  const cancelled = await assertRejects(
    () =>
      extractBoundedUploadText(
        minimalPdf("cancelled"),
        "source.pdf",
        "application/pdf",
        controller.signal,
      ),
    UploadExtractionError,
  );
  assertEquals(cancelled.status, 503);
  assertEquals(cancelled.retryable, true);
});

Deno.test("the ingest function source closure excludes the heavy parser", async () => {
  const root = new URL("../ingest-upload/index.ts", import.meta.url);
  const visited = new Set<string>();
  const visit = async (url: URL): Promise<string> => {
    if (visited.has(url.href)) return "";
    visited.add(url.href);
    const source = await Deno.readTextFile(url);
    let closure = `\n// ${url.pathname}\n${source}`;
    for (
      const match of source.matchAll(
        /(?:from\s+|import\s*\()?["'](\.\.?\/[^"']+)["']/g,
      )
    ) {
      const child = new URL(match[1], url);
      if (child.pathname.endsWith(".ts")) closure += await visit(child);
    }
    return closure;
  };
  const closure = await visit(root);
  assertEquals(closure.includes("npm:unpdf"), false);
  assertEquals(
    Array.from(visited).some((href) => href.endsWith("/upload-extraction.ts")),
    false,
  );
});
