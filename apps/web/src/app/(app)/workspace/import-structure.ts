import type { Section } from "@prompted/shared";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isPageMarker(lines: string[], index: number): boolean {
  const value = cleanLine(lines[index] ?? "");
  if (/^page\s+\d+(?:\s+(?:of|\/)\s+\d+)?$/i.test(value)) return true;
  if (!/^\d{1,4}$/.test(value)) return false;

  const previous = lines[index - 1]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return index === 0 || index === lines.length - 1 || !previous || !next;
}

export function isLikelyHeading(line: string): boolean {
  const value = cleanLine(line);
  if (!value || value.length > 100) return false;
  if (/^#{1,6}\s+/.test(value)) return true;
  if (/^\d+(?:\.\d+)*[.)]?\s+[A-Z]/.test(value)) return true;
  if (/^[A-Z][A-Z\s/&-]{2,}$/.test(value)) return true;
  if (/^(introduction|overview|summary|background|objectives?|scope|findings?|recommendations?|conclusion|next steps?|action plan|timeline|budget|risks?|responsibilities|appendix|attachments?)$/i.test(value)) return true;
  const words = value.split(/\s+/);
  const titleCaseWords = words.filter((word) => /^[A-Z][a-z0-9'’-]*$/.test(word));
  return words.length <= 8 && titleCaseWords.length >= Math.ceil(words.length * 0.7) && !/[.!?]$/.test(value);
}

function isLikelySubheading(line: string): boolean {
  const value = cleanLine(line);
  if (!value || value.length > 120) return false;
  if (/^#{2,6}\s+/.test(value)) return true;
  if (/^\d+\.\d+(?:\.\d+)*\s+/.test(value)) return true;
  if (/^[A-Z][^.!?]{2,80}:$/.test(value)) return true;
  return false;
}

function headingText(line: string): string {
  return cleanLine(line)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .replace(/:$/, "")
    .trim();
}

export function normaliseParagraphs(lines: string[]): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (value) blocks.push(value);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    if (isLikelySubheading(line)) {
      flushParagraph();
      blocks.push(`## ${headingText(line)}`);
      continue;
    }

    if (/^[-•*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      blocks.push(line.replace(/^•\s+/, "- "));
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks.join("\n\n");
}

const JOB_DATE_RANGE =
  /(?:19|20)\d{2}\s*(?:-|–|—|to|until|\/)\s*(?:(?:19|20)\d{2}|present|current|now)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}/i;
const JOB_TITLE_WORD =
  /\b(manager|assistant|coordinator|supervisor|operator|administrator|chef|cook|server|waiter|waitress|bartender|barista|sales|consultant|director|officer|lead|labourer|technician|specialist|analyst|clerk|receptionist|driver|worker|owner|founder|engineer|developer|designer|instructor|trainer|soldier|rifleman|infantry)\b/i;

interface SplitJob {
  title: string;
  content: string;
}

function looksLikeJobBoundary(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 140) return false;
  if (/^[-•*●▪·]/.test(trimmed)) return false;
  if (JOB_DATE_RANGE.test(trimmed) && (JOB_TITLE_WORD.test(trimmed) || /\bat\b|\||,/.test(trimmed))) {
    return true;
  }
  return Boolean(
    trimmed.length <= 90 &&
      JOB_TITLE_WORD.test(trimmed) &&
      !JOB_DATE_RANGE.test(trimmed) &&
      nextLine !== undefined &&
      JOB_DATE_RANGE.test(nextLine),
  );
}

export function splitExperienceIntoJobs(content: string): SplitJob[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const jobs: SplitJob[] = [];
  let current: SplitJob | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (looksLikeJobBoundary(line, lines[index + 1])) {
      if (current && current.content.trim()) jobs.push(current);
      current = { title: cleanLine(line).slice(0, 80), content: line };
    } else if (current) {
      current.content += `\n${line}`;
    } else {
      current = { title: "", content: line };
    }
  }

  if (current && current.content.trim()) jobs.push(current);
  return jobs.map((job) => ({ ...job, content: job.content.trim() }));
}

export function splitImportedDocument(params: {
  extracted: string;
  documentId: string;
  userId: string;
  now: string;
}): Section[] {
  const extractedLines = params.extracted
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const lines = extractedLines.filter((_, index) => !isPageMarker(extractedLines, index));

  const rawSections: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } = { name: "Introduction", lines: [] };

  for (const line of lines) {
    if (isLikelyHeading(line) && !isLikelySubheading(line)) {
      if (current.lines.some((item) => item.trim())) rawSections.push(current);
      current = { name: headingText(line) || "Untitled section", lines: [] };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.some((item) => item.trim()) || rawSections.length === 0) rawSections.push(current);

  const meaningful = rawSections
    .map((section) => ({ name: section.name, content: normaliseParagraphs(section.lines) }))
    .filter((section) => section.content.trim() || section.name !== "Introduction");

  let source = meaningful;
  if (source.length === 0) {
    const rawJobs = splitExperienceIntoJobs(params.extracted.trim());
    source = rawJobs.length >= 2
      ? rawJobs.map((job, index) => ({
          name: job.title || `Work Experience — Job ${index + 1}`,
          content: job.content,
        }))
      : [{ name: "Document content", content: params.extracted.trim() }];
  }

  const expanded = source.flatMap((section) => {
    if (!/\b(professional|work)\s+experience\b|\bemployment\s+history\b/i.test(section.name)) {
      return [section];
    }
    const jobs = splitExperienceIntoJobs(section.content);
    if (jobs.length < 2) return [section];
    return jobs.map((job, jobIndex) => ({
      name: job.title ? `${section.name} — ${job.title}` : `${section.name} — Job ${jobIndex + 1}`,
      content: job.content,
    }));
  });

  return expanded.map((section, index) => ({
    id: makeId("section"),
    document_id: params.documentId,
    user_id: params.userId,
    name: section.name,
    order_index: index,
    content: section.content,
    status: "draft",
    version_history: [{
      content: section.content,
      saved_at: params.now,
      label: "Original imported content",
      origin: "imported_original",
    }],
    is_required: true,
    created_at: params.now,
    updated_at: params.now,
  }));
}
