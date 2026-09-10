"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers";
import { captureOwnerDispatch, ownerDispatchIsCurrent, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import { downloadWorkspaceUpload, getWorkspaceUpload, listWorkspaceUploads } from "@/lib/api/import-workspace";
import { isWorkspaceUploadId, type WorkspaceUploadDetail, type WorkspaceUploadPage } from "@prompted/shared/ingest-upload";
import styles from "./RetainedWorkspaceUploads.module.css";
import { canReviewRetainedText } from "./retained-text-review";

type ReadState<T> = { lease: OwnerDispatchLease; resource?: string; value?: T; error?: string };

export function RetainedWorkspaceUploads({ selectedUploadId = null }: { selectedUploadId?: string | null }) {
  const { user, loading } = useAuth();
  const owner = user?.id;
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<ReadState<WorkspaceUploadPage> | null>(null);
  const [detail, setDetail] = useState<ReadState<WorkspaceUploadDetail | null> | null>(null);
  const [morePending, setMorePending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [signInError, setSignInError] = useState(false);
  const pageLease = useRef<OwnerDispatchLease | null>(null);
  const detailLease = useRef<OwnerDispatchLease | null>(null);
  const selectionController = useRef<AbortController | null>(null);
  const paging = useRef(false);
  const downloading = useRef(false);
  const objectUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useLayoutEffect(() => {
    const controller = new AbortController();
    setPage(null); setMorePending(false); setSignInError(false); paging.current = false; pageLease.current = null;
    if (!owner || loading) return () => controller.abort();
    let lease: OwnerDispatchLease;
    try { lease = captureOwnerDispatch(owner, controller.signal); }
    catch { setSignInError(true); return () => controller.abort(); }
    pageLease.current = lease;
    setPage({ lease });
    void listWorkspaceUploads(null, lease).then((value) => {
      if (ownerDispatchIsCurrent(lease)) setPage({ lease, value });
    }, () => {
      if (ownerDispatchIsCurrent(lease)) setPage({ lease, error: "Your uploaded files could not be loaded. Try refreshing the list." });
    });
    return () => { controller.abort(); if (pageLease.current === lease) pageLease.current = null; };
  }, [owner, loading, refresh]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    selectionController.current = controller;
    setDetail(null); setDownloadPending(false); setDownloadMessage(null);
    downloading.current = false; detailLease.current = null;
    if (!owner || loading || !isWorkspaceUploadId(selectedUploadId)) return () => controller.abort();
    let lease: OwnerDispatchLease;
    try { lease = captureOwnerDispatch(owner, controller.signal); }
    catch { setSignInError(true); return () => controller.abort(); }
    detailLease.current = lease;
    setDetail({ lease, resource: selectedUploadId });
    void getWorkspaceUpload(selectedUploadId, lease).then((value) => {
      if (ownerDispatchIsCurrent(lease)) setDetail({ lease, resource: selectedUploadId, value });
    }, () => {
      if (ownerDispatchIsCurrent(lease)) setDetail({ lease, resource: selectedUploadId, error: "This file could not be checked. Refresh to try again; its availability is not confirmed." });
    });
    const urls = objectUrls.current;
    return () => {
      controller.abort(); if (detailLease.current === lease) detailLease.current = null;
      for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
    };
  }, [owner, loading, selectedUploadId, refresh]);

  const visiblePage = !loading && page && page.lease.expectedUserId === owner?.toLowerCase() && ownerDispatchIsCurrent(page.lease) ? page : null;
  const visibleDetail = !loading && detail?.resource === selectedUploadId && detail?.lease.expectedUserId === owner?.toLowerCase() && ownerDispatchIsCurrent(detail.lease) &&
    (detail.value == null || detail.value.upload_id.toLowerCase() === selectedUploadId?.toLowerCase()) ? detail : null;

  const loadMore = useCallback(async () => {
    const lease = pageLease.current;
    if (!lease || !visiblePage?.value?.next_cursor || paging.current) return;
    paging.current = true; setMorePending(true);
    const prior = visiblePage.value;
    try {
      const next = await listWorkspaceUploads(prior.next_cursor, lease);
      lease.assertCurrent();
      const priorIds = new Set(prior.items.map((row) => row.upload_id));
      if (next.items.some((row) => priorIds.has(row.upload_id))) throw new Error("UPLOAD_PAGE_OVERLAP");
      setPage({ lease, value: { items: [...prior.items, ...next.items], next_cursor: next.next_cursor } });
    } catch {
      if (ownerDispatchIsCurrent(lease)) setPage({ lease, value: prior, error: "More files could not be loaded. Try again." });
    } finally {
      if (ownerDispatchIsCurrent(lease)) { paging.current = false; setMorePending(false); }
    }
  }, [visiblePage]);

  const download = useCallback(async () => {
    const lease = detailLease.current;
    if (!lease || !selectedUploadId || downloading.current) return;
    downloading.current = true; setDownloadPending(true); setDownloadMessage(null);
    try {
      const result = await downloadWorkspaceUpload(selectedUploadId, lease);
      lease.assertCurrent();
      const url = URL.createObjectURL(result.blob);
      objectUrls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }, 1000));
      const link = document.createElement("a");
      link.href = url; link.download = result.fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
      document.body.appendChild(link);
      try { lease.assertCurrent(); link.click(); }
      finally { link.remove(); }
      setDownloadMessage("Original file prepared for download. Check your browser’s downloads.");
    } catch {
      if (ownerDispatchIsCurrent(lease)) setDownloadMessage("The original could not be downloaded or its bytes could not be verified. Try again.");
    } finally {
      if (ownerDispatchIsCurrent(lease)) { downloading.current = false; setDownloadPending(false); }
    }
  }, [selectedUploadId]);

  if (loading || !owner) return null;
  const source = visibleDetail?.value;
  return <section className={styles.panel} aria-labelledby="retained-uploads-title">
    <h2 id="retained-uploads-title" className={styles.heading}>Uploaded originals</h2>
    <p>Open the file you uploaded or inspect its extracted text. The original is kept separately from saved document wording.</p>
    <button className={styles.button} onClick={() => { selectionController.current?.abort(); setRefresh((value) => value + 1); }}>Refresh files</button>
    {signInError && <p role="alert">Your sign-in could not be confirmed. Reconnect to your account and refresh files.</p>}
    <div className={styles.layout}>
      <div className={styles.detail}>
        {!selectedUploadId && <p>Select a file to open its original and preview.</p>}
        {selectedUploadId && !isWorkspaceUploadId(selectedUploadId) && <p role="alert">This uploaded-file link is invalid.</p>}
        {!signInError && isWorkspaceUploadId(selectedUploadId) && !visibleDetail?.error && visibleDetail?.value === undefined && (detail && !visibleDetail
          ? <p>Refresh to recheck this file.</p> : <p role="status">Checking the selected file…</p>)}
        {visibleDetail?.error && <p role="alert">{visibleDetail.error}</p>}
        {visibleDetail?.value === null && <p>This file was not found in this account.</p>}
        {source && <>
          <h3>{source.file_name}</h3>
          <p>{source.byte_length === null ? "Size not recorded" : `${source.byte_length.toLocaleString()} bytes`} · {source.ingest_status === "legacy" ? `Historical upload: ${source.status}` : `Text processing: ${source.ingest_status.replaceAll("_", " ")}`}</p>
          {source.original ? <button className={styles.button} disabled={downloadPending} onClick={() => void download()}>{downloadPending ? "Preparing original…" : "Download original"}</button> : <p>The original is not currently available. Refresh to check again.</p>}
          {downloadMessage && <p role="status">{downloadMessage}</p>}
          <p>This view protects the uploaded file by keeping it unchanged. Formatting-preserving editing is not available in this view.</p>
          {source.imported_document && <p><Link href={`/outcomes/${source.imported_document.outcome_id}`}>Open saved workspace</Link> — saved wording may differ from the original file.</p>}
          {canReviewRetainedText(source) && <p><Link href={`/workspace?upload=${source.upload_id}&review=text`}>Review text sections</Link> — check the retained wording before creating an editable workspace.</p>}
          {source.preview ? <>
            <h4>Extracted text preview</h4>
            <p>{source.preview.truncated === true ? "This preview is incomplete." : source.preview.truncated === null ? "Preview completeness has not been verified." : "Extraction recorded this preview as complete."} It does not reproduce the original layout.</p>
            <textarea className={styles.preview} aria-label="Extracted text preview" readOnly value={source.preview.text} />
          </> : <p>No extracted text preview is available.</p>}
        </>}
      </div>
      <div className={styles.files}>
        {!signInError && !visiblePage?.value && !visiblePage?.error && (page && !visiblePage
          ? <p>Refresh files to reconnect to this account.</p> : <p role="status">Loading your files…</p>)}
        {visiblePage?.error && <p role="alert">{visiblePage.error}</p>}
        {visiblePage?.value?.items.length === 0 && <p>No uploaded files were found in this account.</p>}
        <ul className={styles.list}>{visiblePage?.value?.items.map((item) => <li key={item.upload_id}>
          <Link href={`/workspace?upload=${item.upload_id}`} onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented && item.upload_id !== selectedUploadId)
              selectionController.current?.abort();
          }} aria-current={selectedUploadId === item.upload_id ? "page" : undefined}>{item.file_name}</Link>
          <div>{item.original ? "Original available" : "Original availability not confirmed"}</div>
        </li>)}</ul>
        {visiblePage?.value?.next_cursor && <button className={styles.button} disabled={morePending} onClick={() => void loadMore()}>{morePending ? "Loading…" : "Load more files"}</button>}
      </div>
    </div>
  </section>;
}
