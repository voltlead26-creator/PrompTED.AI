import { DIPS } from "../_shared/document-intelligence-profiles.ts";
import type { Domain } from "../_shared/prompt-builder.ts";

export interface ClarifyTurn {
  role: "user" | "assistant";
  content: string;
}

export function clarificationContext(body: {
  domain?: unknown;
  situation?: unknown;
  extracted_text?: unknown;
  history?: unknown;
  answer?: unknown;
}) {
  function text(value: unknown, limit: number, legacyFirstRequest = false): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error("CLARIFICATION_INPUT_INVALID");
    // Older web clients stored this presentation prefix with the first user
    // turn. Keep its complete admitted body readable without raising the
    // factual-input limit for new answers or attached text.
    const legacyPrefix = "User request: ";
    const overhead = legacyFirstRequest && value.startsWith(legacyPrefix) ? legacyPrefix.length : 0;
    if (value.length > limit + overhead) throw new Error("CLARIFICATION_INPUT_INVALID");
    return value.trim();
  }
  if (body.history !== undefined && !Array.isArray(body.history)) throw new Error("CLARIFICATION_INPUT_INVALID");
  const history: ClarifyTurn[] = (body.history ?? []).map((turn: unknown) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) throw new Error("CLARIFICATION_INPUT_INVALID");
    const item = turn as Record<string, unknown>;
    if (item.role !== "user" && item.role !== "assistant") throw new Error("CLARIFICATION_INPUT_INVALID");
    const content = text(item.content, 20_000, item.role === "user");
    if (!content) throw new Error("CLARIFICATION_INPUT_INVALID");
    return { role: item.role, content };
  });
  const answer = text(body.answer, 20_000);
  const situation = text(body.situation, 20_000, true);
  const extracted = text(body.extracted_text, 20_000);
  if (!history.length && !answer) throw new Error("CLARIFICATION_INPUT_INVALID");
  const messages = [...history];
  const last = messages.at(-1);
  if (answer && !(last?.role === "user" && last.content === answer)) messages.push({ role: "user", content: answer });
  const profileTurns: ClarifyTurn[] = [
    ...(situation ? [{ role: "user" as const, content: situation }] : []),
    ...messages.filter((turn) => turn.role === "user"),
  ];
  const domain = ["employment", "education", "business", "personal", "finance"].includes(String(body.domain)) ? body.domain as Domain : undefined;
  // A user's latest explicit document selection supersedes earlier choices.
  // Only actual user statements can select a profile. The original upload and
  // assistant history remain provider evidence, not document-selection authority.
  let selectedProfile;
  for (const turn of [...profileTurns].reverse()) {
    const lines = new Set(turn.content.toLowerCase().split(/\n+/).map((line) => line.trim()));
    selectedProfile = DIPS.find((profile) => lines.has(profile.key.toLowerCase()) || lines.has(profile.label.toLowerCase()));
    if (selectedProfile) break;
  }
  if (situation && !messages.some((turn) => turn.role === "user" && turn.content === situation)) messages.unshift({ role: "user", content: `Situation: ${situation}` });
  if (extracted) messages.unshift({ role: "user", content: `Attached document content:\n${extracted}` });
  return {
    history, messages, domain,
    // Used to resolve the existing profile, not appended as system instructions.
    profileHint: selectedProfile?.key || profileTurns.map((turn) => turn.content).join("\n\n"),
  };
}
