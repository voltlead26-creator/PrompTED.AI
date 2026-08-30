// =====================================================
// PrompTED - ingest-upload
// Extracts readable text and retains the immutable original for signed-in users.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  type AuthContext,
  AuthError,
  guardRequest,
} from "../_shared/auth-guard.ts";
import { routeRequest } from "../_shared/provider-router.ts";
import { decodeBase64 } from "jsr:@std/encoding/base64";

interface IngestBody {
  filename?: string;
  mime?: string;
  content_base64?: string;
  note?: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 20000;

class ExtractError extends Error {}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function safeFilename(name: string): string {
  return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  ).slice(0, 180) || "document";
}

async function extract(
  bytes: Uint8Array,
  mime: string,
  ext: string,
): Promise<string> {
  if (mime === "application/pdf" || ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("npm:unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text ?? "");
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const mammoth = (await import("npm:mammoth")).default;
    const { Buffer } = await import("node:buffer");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return String(result?.value ?? "");
  }
  if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) {
    return new TextDecoder().decode(bytes);
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    ["xlsx", "xls", "xlsm"].includes(ext)
  ) {
    const XLSX = await import(
      "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
    );
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], {
        blankrows: false,
      });
      if (csv.trim()) parts.push(`## Sheet: ${name}\n${csv.trim()}`);
    }
    return parts.join("\n\n");
  }
  if (mime === "application/msword" || ext === "doc") {
    throw new ExtractError(
      "Old-style .doc files aren't supported yet - please save it as a PDF or .docx and try again.",
    );
  }
  if (
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "heic", "heif"].includes(ext)
  ) {
    throw new ExtractError(
      "TED can't read photos just yet - a PDF or Word document works best.",
    );
  }
  throw new ExtractError(
    "That file type isn't supported yet. PDFs and Word documents work best.",
  );
}

async function retainOriginal(params: {
  auth: AuthContext;
  uploadId: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  extractedText: string;
  truncated: boolean;
}): Promise<string | null> {
  // Public extraction remains available, but an upload row requires a real
  // Supabase user UUID. The client waits for its anonymous test session before
  // starting Master Workspace imports.
  if (params.auth.isAnonymous && params.auth.userId === "anonymous") {
    return null;
  }

  if (params.auth.isAnonymous) {
    const { error } = await params.auth.admin.from("uploads").insert({
      id: params.uploadId,
      user_id: params.auth.userId,
      storage_path: `unretained/${params.uploadId}`,
      file_type: params.mime || extOf(params.filename) || "unknown",
      file_name: params.filename,
      file_size_bytes: params.bytes.byteLength,
      extracted_text: params.extractedText,
      extracted_payload: {
        truncated: params.truncated,
        original_retained: false,
      },
      status: "ready",
      idempotency_key: params.uploadId,
    });
    if (error) throw new Error(`UPLOAD_RECORD_FAILED:${error.message}`);
    return null;
  }

  const storagePath = `${params.auth.userId}/${params.uploadId}/${
    safeFilename(params.filename)
  }`;
  const { error: storageError } = await params.auth.admin.storage
    .from("original-documents")
    .upload(storagePath, params.bytes, {
      contentType: params.mime || "application/octet-stream",
      upsert: false,
    });
  if (storageError) {
    throw new Error(`ORIGINAL_STORAGE_FAILED:${storageError.message}`);
  }

  const { error: rowError } = await params.auth.admin.from("uploads").insert({
    id: params.uploadId,
    user_id: params.auth.userId,
    storage_path: storagePath,
    file_type: params.mime || extOf(params.filename) || "unknown",
    file_name: params.filename,
    file_size_bytes: params.bytes.byteLength,
    extracted_text: params.extractedText,
    extracted_payload: { truncated: params.truncated },
    status: "ready",
    idempotency_key: params.uploadId,
  });

  if (rowError) {
    await params.auth.admin.storage.from("original-documents").remove([
      storagePath,
    ]);
    throw new Error(`UPLOAD_RECORD_FAILED:${rowError.message}`);
  }

  return storagePath;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  let auth: AuthContext;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(
      { error: { message: "Something went wrong." } },
      500,
      origin,
    );
  }

  try {
    let filename = "upload";
    let mime = "";
    let bytes: Uint8Array | null = null;

    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonResponse(
          { error: { message: "file is required" } },
          400,
          origin,
        );
      }
      if (file.size > MAX_BYTES) {
        return jsonResponse(
          {
            error: {
              message:
                "That file is a bit too big to read. Files need to be 8MB or smaller.",
            },
          },
          413,
          origin,
        );
      }
      filename = String(file.name || "upload").slice(0, 300);
      mime = String(file.type || "").toLowerCase();
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = auth.body as unknown as IngestBody;
      filename = String(body.filename ?? "upload").slice(0, 300);
      mime = String(body.mime ?? "").toLowerCase();
      const raw = String(body.content_base64 ?? "").replace(/^data:[^,]*,/, "");
      if (!raw) {
        return jsonResponse(
          { error: { message: "content_base64 is required" } },
          400,
          origin,
        );
      }
      if (raw.length > MAX_BYTES * 1.4) {
        return jsonResponse(
          {
            error: {
              message:
                "That file is a bit too big to read. Files need to be 8MB or smaller.",
            },
          },
          413,
          origin,
        );
      }
      try {
        bytes = decodeBase64(raw);
      } catch {
        return jsonResponse(
          {
            error: {
              message: "The file didn't arrive intact. Please try again.",
            },
          },
          400,
          origin,
        );
      }
    }

    if (!bytes) {
      return jsonResponse(
        {
          error: {
            message:
              "The file did not contain readable bytes. Please try again.",
          },
        },
        400,
        origin,
      );
    }

    let text: string;
    try {
      text = await extract(bytes, mime, extOf(filename));
    } catch (err) {
      const message = err instanceof ExtractError
        ? err.message
        : "TED couldn't read that file. Please try a PDF or Word document.";
      return jsonResponse({ error: { message } }, 422, origin);
    }

    const clean = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
    if (!clean) {
      return jsonResponse(
        {
          error: {
            message:
              "TED couldn't find readable text in that file. If it's a scan or photo, try a text-based PDF or Word document.",
          },
        },
        422,
        origin,
      );
    }

    const uploadId = crypto.randomUUID();
    const truncated = clean.length > MAX_CHARS;
    const sliced = clean.slice(0, MAX_CHARS);
    let storagePath: string | null = null;

    try {
      storagePath = await retainOriginal({
        auth,
        uploadId,
        filename,
        mime,
        bytes,
        extractedText: sliced,
        truncated,
      });
    } catch (_error) {
      return jsonResponse(
        {
          error: {
            code: "ORIGINAL_RETENTION_FAILED",
            message:
              "TED read the file but could not save the original safely. Nothing was added. Please try again.",
          },
        },
        503,
        origin,
      );
    }

    // Read-back: mirror the document's own structure so the user can see
    // TED actually read it — never a flat text dump — plus TED's own-words
    // summary of what the document is for. Falls back gracefully: structure
    // may be null, and summary may be empty, without failing the upload.
    let summary = "";
    let structure: { title: string; items: string[] }[] | null = null;
    let documentType = "";
    try {
      const result = await routeRequest({
        task: "recommend",
        systemPrompt:
          "You are TED, PrompTED's assistant. You will receive text extracted from a document a user just uploaded. " +
          "Respond ONLY with a JSON object, no prose and no markdown fences: " +
          '{ "document_type": "...", "purpose": "...", "sections": [{ "title": "...", "items": ["..."] }] }. ' +
          "document_type: 2-5 plain words naming what this document is. " +
          "purpose: 1-3 warm plain-English sentences, in your own words, explaining what this document is for and what it means for the person — never technical, never a restatement of headings. " +
          "sections: mirror the document's OWN structure and ordering — use its real headings as titles and its real entries as items (shortened to a line each, at most 12 items per section, at most 12 sections). If the document has no clear sections, return one section titled after the document itself.",
        messages: [{ role: "user", content: sliced.slice(0, 12000) }],
        maxTokens: 1600,
        signal: req.signal,
      });
      const raw = (result.text ?? "").trim().replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "");
      const parsed = JSON.parse(raw) as {
        document_type?: unknown;
        purpose?: unknown;
        sections?: unknown;
      };
      documentType = String(parsed.document_type ?? "").slice(0, 80);
      summary = String(parsed.purpose ?? "").trim().slice(0, 600);
      if (Array.isArray(parsed.sections)) {
        structure = parsed.sections
          .slice(0, 12)
          .map((s) => {
            const sec = s as { title?: unknown; items?: unknown };
            return {
              title: String(sec.title ?? "").slice(0, 120),
              items: Array.isArray(sec.items)
                ? sec.items.slice(0, 12).map((it) => String(it).slice(0, 200))
                : [],
            };
          })
          .filter((s) => s.title || s.items.length > 0);
        if (structure.length === 0) structure = null;
      }
    } catch (_error) {
      // Keep whatever we managed to produce; the upload itself succeeded.
    }

    return jsonResponse(
      {
        upload_id: uploadId,
        extracted_text: sliced,
        original_retained: Boolean(storagePath),
        storage_path: storagePath,
        confirm_payload: {
          summary,
          document_type: documentType,
          structure,
          filename,
          char_count: sliced.length,
          truncated,
        },
      },
      200,
      origin,
    );
  } catch (_error) {
    return jsonResponse(
      { error: { message: "Something went wrong reading the file." } },
      500,
      origin,
    );
  }
});
