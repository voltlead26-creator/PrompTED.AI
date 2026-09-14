import { MasterWorkspaceImport } from "./MasterWorkspaceImport";
import { RetainedWorkspaceUploads } from "./RetainedWorkspaceUploads";
import styles from "./WorkspacePage.module.css";

export default async function WorkspacePage({ searchParams }: {
  searchParams: Promise<{ upload?: string | string[]; review?: string | string[] }>;
}) {
  const query = await searchParams;
  const selectedUploadId = typeof query.upload === "string" ? query.upload : query.upload ? "invalid" : null;
  const reviewUploadId = query.review === "text" ? selectedUploadId : null;
  return <div className={styles.page}>
    {selectedUploadId && !reviewUploadId && <RetainedWorkspaceUploads selectedUploadId={selectedUploadId} />}
    <MasterWorkspaceImport initialUploadId={reviewUploadId} />
    {(!selectedUploadId || reviewUploadId) && <RetainedWorkspaceUploads selectedUploadId={selectedUploadId} />}
  </div>;
}
