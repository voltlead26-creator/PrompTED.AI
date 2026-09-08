import { MasterWorkspaceImport } from "./MasterWorkspaceImport";
import { RetainedWorkspaceUploads } from "./RetainedWorkspaceUploads";

export default async function WorkspacePage({ searchParams }: {
  searchParams: Promise<{ upload?: string | string[] }>;
}) {
  const query = await searchParams;
  const selectedUploadId = typeof query.upload === "string" ? query.upload : query.upload ? "invalid" : null;
  return <div style={{ overflowY: "auto", height: "100%" }}>
    {selectedUploadId && <RetainedWorkspaceUploads selectedUploadId={selectedUploadId} />}
    <MasterWorkspaceImport />
    {!selectedUploadId && <RetainedWorkspaceUploads />}
  </div>;
}
