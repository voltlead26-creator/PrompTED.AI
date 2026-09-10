import { MasterWorkspaceImport } from "./MasterWorkspaceImport";
import { RetainedWorkspaceUploads } from "./RetainedWorkspaceUploads";

export default async function WorkspacePage({ searchParams }: {
  searchParams: Promise<{ upload?: string | string[]; review?: string | string[] }>;
}) {
  const query = await searchParams;
  const selectedUploadId = typeof query.upload === "string" ? query.upload : query.upload ? "invalid" : null;
  const reviewUploadId = query.review === "text" ? selectedUploadId : null;
  return <div style={{ overflowY: "auto", height: "100%" }}>
    {selectedUploadId && !reviewUploadId && <RetainedWorkspaceUploads selectedUploadId={selectedUploadId} />}
    <MasterWorkspaceImport initialUploadId={reviewUploadId} />
    {(!selectedUploadId || reviewUploadId) && <RetainedWorkspaceUploads selectedUploadId={selectedUploadId} />}
  </div>;
}
