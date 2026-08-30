import {
  getTemplate,
  getTemplateByName,
  resolveTemplateByRecommendationName,
  type CatalogTemplate,
} from "@prompted/shared/catalogue";
import type { PendingOutcome } from "./workspace-store";

export interface GenerationDefaults {
  templateName: string;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  uploadId?: string;
}

export type GenerationTemplate = Pick<
  CatalogTemplate,
  "id" | "slug" | "name" | "sections" | "domain" | "structure_type" | "advice_boundary"
>;

/**
 * Legacy catalogue compatibility is deliberately isolated behind a dynamic
 * import. Critical persisted workspace state does not need 86 full template
 * definitions; only a legacy generation attempt does.
 */
export function resolveGenerationTemplate(
  pending: PendingOutcome | null,
  defaults: GenerationDefaults,
): { defaults: GenerationDefaults; template: GenerationTemplate | undefined } {
  const template =
    (pending?.templateId ? getTemplate(pending.templateId) : undefined) ??
    resolveTemplateByRecommendationName(defaults.templateName) ??
    getTemplateByName(defaults.templateName);

  return {
    defaults: {
      ...defaults,
      templateName: template?.name ?? defaults.templateName,
      templateId: template?.slug ?? template?.id ?? pending?.templateId ?? defaults.templateId,
    },
    template,
  };
}
