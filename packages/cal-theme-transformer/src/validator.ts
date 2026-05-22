type CalResourceRef = Readonly<{
  raw: string;
  brandKey: string;
}>;

type CalAst = Readonly<{
  warnings: string[];
  tags: string[];
  params: Readonly<Record<string, string>>;
  outputs: string[];
  commands: string[];
  pipelineSteps: number;
  resources: CalResourceRef[];
  agents: string[];
}>;

export const knownBrands = ["default", "brand", "acme", "client"] as const;

export type ValidationError = Readonly<{
  code: string;
  message: string;
  path?: string;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}>;

const knownSystemTags = new Set(["dark", "light"]);
const knownParamKeys = new Set(["color", "radius"]);
const paramSuggestions: Record<string, string> = {
  colours: "color",
  colourscheme: "color",
  coloursystem: "color",
  typo: "radius",
  fonts: "color",
  rounded: "radius",
  space: "radius"
};

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateCalAst(ast: CalAst): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings = [...ast.warnings];

  const normalizedSystemTags = ast.tags
    .map((tag: string) => tag.toLowerCase())
    .filter((tag: string) => knownSystemTags.has(tag) || tag.startsWith("brand:"));

  for (const tag of duplicateValues(normalizedSystemTags)) {
    warnings.push(`Duplicate system tag detected: %${tag}`);
  }

  for (const key of Object.keys(ast.params)) {
    if (knownParamKeys.has(key)) continue;
    const suggestion = paramSuggestions[key.toLowerCase()];
    warnings.push(
      suggestion
        ? `Unknown param key "${key}". Did you mean "${suggestion}"?`
        : `Unknown param key "${key}".`
    );
  }

  if (ast.outputs.length === 0 && ast.commands.length > 0) {
    warnings.push("No outputs specified for commands, output may be lost");
  }

  if (ast.pipelineSteps > 20) {
    warnings.push("Large pipeline may exceed timeout limits");
  }

  for (const resource of ast.resources) {
    if (resource.brandKey && !knownBrands.includes(resource.brandKey as (typeof knownBrands)[number])) {
      warnings.push(`Unknown brand resource key "${resource.brandKey}" in ${resource.raw}`);
    }
  }

  if (ast.agents.length === 0 && ast.commands.length > 0) {
    warnings.push("Commands without agents may run in default context");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
