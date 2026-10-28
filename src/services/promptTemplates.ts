/**
 * Prompt templates: the structure that used to hold canned replies, kept as
 * instructions for the model. A template says what a reply is for, how it is
 * structured, which real data it must use, and may carry a style example that
 * the model is told not to copy. The model writes every word of the output.
 */
/**
 * A prompt template: what a reply is for, how it should be structured, the
 * real data it must use, and optionally a style example. The template is an
 * instruction to the model; the model writes every word of the reply.
 */
export interface PromptTemplate {
  id: string;
  purpose: string;
  structure: string[];
  data?: Record<string, string>;
  /** Illustrates tone only; the model is told not to copy it. */
  styleExamples?: string[];
}

/** Render a prompt template as model instructions. */
export function renderPromptTemplate(template: PromptTemplate): string {
  const lines = [
    `[Reply template: ${template.id}]`,
    `Purpose of this reply: ${template.purpose}`,
    "Structure to follow:",
    ...template.structure.map((step, i) => `${i + 1}. ${step}`),
  ];
  const data = Object.entries(template.data || {}).filter(
    ([, value]) => value !== ""
  );
  if (data.length > 0) {
    lines.push("Real data to use (do not invent other facts about it):");
    data.forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
  }
  if (template.styleExamples && template.styleExamples.length > 0) {
    lines.push(
      "Style examples (EXAMPLES ONLY - show tone; never copy them verbatim, write your own words for this specific user):"
    );
    template.styleExamples.forEach(example => lines.push(`> ${example}`));
  }
  return lines.join("\n");
}

