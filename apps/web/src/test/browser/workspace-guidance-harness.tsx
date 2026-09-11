import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Section } from "@prompted/shared/browser";
import { SectionEditor } from "../../components/organisms/SectionEditor";
import "../../design-system/tokens.css";

window.guidanceTest = { hold: false, fail: false, requests: 0, edits: [] };
const initial: Section = {
  id: "22222222-2222-4222-8222-222222222222", document_id: "11111111-1111-4111-8111-111111111111",
  user_id: "33333333-3333-4333-8333-333333333333", name: "Response request", order_index: 0,
  content: "<p>Please provide a reply within <strong>14 days</strong>.</p>", status: "draft", version_history: [],
  is_required: true, created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z",
};
function Harness() {
  const [section, setSection] = useState(initial);
  return <main style={{ fontFamily: "Arial, sans-serif", maxWidth: 1160, margin: "0 auto", padding: 12 }}>
    <h1>Workspace guidance</h1>
    <p>Synthetic document. Provider responses are controlled locally; this fixture does not save to an account.</p>
    <button onClick={() => setSection({ ...initial, id: "22222222-2222-4222-8222-222222222223", name: "Next section" })}>Switch section</button>
    <SectionEditor section={section} ledgerBindingStatus="captured" workspaceSaved
      onEdit={(_id, content) => setSection((current) => ({ ...current, content }))}
      onApprove={() => {}} onUnapprove={() => {}} onToggleLock={() => {}} onOpenHistory={() => {}} />
    <output data-testid="document-content">{section.content}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
