import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadWorkspaceUpload, getWorkspaceUpload, listWorkspaceUploads } from "./import-workspace";
import { captureOwnerDispatch, recordBrowserPrincipal, type OwnerDispatchLease } from "@/lib/browser-principal-state";

const { rpc, download } = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: async (lease: OwnerDispatchLease, action: (client: unknown) => Promise<unknown>) => {
    lease.assertCurrent();
    const value = await action({ rpc, storage: { from: (bucket: string) => {
      expect(bucket).toBe("original-documents"); return { download: (...args: unknown[]) => ({ asStream: () => download(...args) }) };
    } } });
    lease.assertCurrent(); return value;
  },
}));
const owner = "95071240-0000-4000-8000-000000000001";
const id = "95071240-0000-8000-8000-000000000011";
const source = { upload_id: id, file_name: "original.pdf", mime_type: "application/pdf", byte_length: 3,
  created_at: "2026-09-07T01:02:03.123456+00:00", status: "failed", ingest_status: "failed", format: "pdf",
  original: { storage_path: `${owner}/${id}/original.pdf`, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
  imported_document: null, preview: null };
const receipt = { version: "workspace-upload.1", owner_user_id: owner, source };
describe("workspace original API", () => {
  beforeEach(() => {
    vi.resetAllMocks(); recordBrowserPrincipal(owner);
    vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("crypto", webcrypto);
    rpc.mockResolvedValue({ data: receipt, error: null });
    download.mockResolvedValue({ data: new NodeBlob(["abc"]).stream(), error: null });
  });
  afterEach(() => { recordBrowserPrincipal(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("gets the owned resource by exact ID and keeps absent distinct", async () => {
    await expect(getWorkspaceUpload(id, captureOwnerDispatch(owner))).resolves.toEqual(source);
    expect(rpc).toHaveBeenCalledWith("get_own_workspace_upload_v1", { p_upload_id: id });
    rpc.mockResolvedValue({ data: { ...receipt, source: null }, error: null });
    await expect(getWorkspaceUpload(id, captureOwnerDispatch(owner))).resolves.toBeNull();
  });
  it("forwards the precise page cursor and propagates read errors", async () => {
    const error = new Error("offline"); rpc.mockResolvedValue({ data: null, error });
    const cursor = { created_at: source.created_at, upload_id: id };
    await expect(listWorkspaceUploads(cursor, captureOwnerDispatch(owner))).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledWith("list_own_workspace_uploads_v1", { p_before_created_at: source.created_at, p_before_id: id });
  });
  it("reads back and verifies exact original bytes before returning a downloadable Blob", async () => {
    const result = await downloadWorkspaceUpload(id, captureOwnerDispatch(owner));
    expect(await result.blob.text()).toBe("abc"); expect(result.fileName).toBe("original.pdf");
    expect(download).toHaveBeenCalledWith(source.original.storage_path, {}, expect.objectContaining({ cache: "no-store", redirect: "error" }));
  });
  it("allows historical bytes without claiming a digest exists", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, source: { ...source, original: { ...source.original, sha256: null } } }, error: null });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).resolves.toMatchObject({ fileName: source.file_name });
  });
  it.each(["wrong", "xyz", ""])("rejects wrong length/digest original %s", async (text) => {
    download.mockResolvedValue({ data: new NodeBlob([text]).stream(), error: null });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ORIGINAL_BYTES_MISMATCH");
  });
  it("does not request bytes when readback finds no original", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, source: { ...source, original: null } }, error: null });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ORIGINAL_UNAVAILABLE");
    expect(download).not.toHaveBeenCalled();
  });
  it("propagates a Storage read failure", async () => {
    const error = new Error("storage offline"); download.mockResolvedValue({ data: null, error });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toBe(error);
  });
  it("fences bytes returned after selection cancellation", async () => {
    const controller = new AbortController();
    download.mockImplementation(async () => { controller.abort(new Error("selection retired")); return { data: new NodeBlob(["abc"]).stream(), error: null }; });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner, controller.signal))).rejects.toThrow("selection retired");
  });
  it("fences readback after an owner A to B to A transition", async () => {
    rpc.mockImplementation(async () => { recordBrowserPrincipal(id); recordBrowserPrincipal(owner); return { data: receipt, error: null }; });
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });
  it("rejects malformed identities before dispatch", async () => {
    await expect(getWorkspaceUpload("missing", captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ID_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });
  function realStorage(stream: ReadableStream<Uint8Array>) {
    const fetch = vi.fn(async () => new Response(stream));
    const client = createClient("https://example.supabase.co", "synthetic-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false }, accessToken: async () => "synthetic-owner-token", global: { fetch },
    });
    download.mockImplementation((path: string, options: object, parameters: { signal?: AbortSignal; cache?: RequestCache; redirect?: RequestRedirect }) =>
      client.storage.from("original-documents").download(path, options, parameters).asStream());
    return fetch;
  }
  it.each(["a#b.pdf", "a?b.pdf", "a%2e%2e.pdf", "a\\b.pdf", "日本語.pdf"])("requests exact historical object %s through the installed SDK", async (name) => {
    const path = `${owner}/historical/${name}`;
    rpc.mockResolvedValue({ data: { ...receipt, source: { ...source, original: { storage_path: path, sha256: null } } }, error: null });
    const fetch = realStorage(streamOf(new Uint8Array([97, 98, 99])));
    await downloadWorkspaceUpload(id, captureOwnerDispatch(owner));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe(`/storage/v1/object/original-documents/${owner}/historical/${encodeURIComponent(name)}`);
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it("cancels an oversized stream before consuming the rest", async () => {
    const cancel = vi.fn();
    realStorage(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); }, cancel }));
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ORIGINAL_BYTES_MISMATCH");
    expect(cancel).toHaveBeenCalled();
  });
  it("bounds an unknown-size historical original at the exact 8 MiB ceiling", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, source: { ...source, byte_length: null, original: { ...source.original, sha256: null } } }, error: null });
    realStorage(streamOf(new Uint8Array(8 * 1024 * 1024)));
    const result = await downloadWorkspaceUpload(id, captureOwnerDispatch(owner));
    expect(result.blob.size).toBe(8 * 1024 * 1024);
  });
  it("times out and cancels a stalled stream through the installed SDK", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(); const fetched = deferred<void>();
    realStorage(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([97])); fetched.resolve(); }, cancel }));
    const promise = downloadWorkspaceUpload(id, captureOwnerDispatch(owner));
    const rejection = expect(promise).rejects.toThrow("UPLOAD_ORIGINAL_TIMEOUT");
    await fetched.promise; await vi.advanceTimersByTimeAsync(30001); await rejection;
    expect(cancel).toHaveBeenCalled();
  });
  it("bounds empty chunks and cancels before a hostile stream can exhaust work", async () => {
    let pulls = 0; const cancel = vi.fn();
    realStorage(new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array()); }, cancel }));
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ORIGINAL_READ_LIMIT");
    expect(pulls).toBeLessThan(40); expect(cancel).toHaveBeenCalled();
  });
  it("rejects an EOF delivered after the deadline before the timer task runs", async () => {
    vi.useFakeTimers(); let reads = 0;
    rpc.mockResolvedValue({ data: { ...receipt, source: { ...source, original: { ...source.original, sha256: null } } }, error: null });
    realStorage(new ReadableStream({ pull(controller) {
      if (++reads === 1) controller.enqueue(new Uint8Array([97, 98, 99]));
      else { vi.setSystemTime(Date.now() + 30001); controller.close(); }
    } }, { highWaterMark: 0 }));
    await expect(downloadWorkspaceUpload(id, captureOwnerDispatch(owner))).rejects.toThrow("UPLOAD_ORIGINAL_TIMEOUT");
    expect(reads).toBe(2);
  });
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function streamOf(bytes: Uint8Array) { return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }); }
