export type CalSymbol = "@" | "/" | "$" | "%" | "->";

export type CalResourceType = "image" | "text";

export type CalResourceRef = Readonly<{
  raw: string;
  symbol: "$";
  type: CalResourceType;
  brandKey: string;
  path: string;
  fullKey: string;
  explicitBrand: boolean;
}>;

export type CalAst = Readonly<{
  version: "cal/1.0";
  originalPrompt: string;
  normalizedPrompt: string;
  agents: string[];
  commands: string[];
  resources: CalResourceRef[];
  lockedTexts: string[];
  tags: string[];
  params: Readonly<Record<string, string>>;
  outputs: string[];
  pipelineSteps: number;
  warnings: string[];
}>;

const CAL_RESOURCE_RE = /\$([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu;
const CAL_AGENT_RE = /(^|\s)@([\p{L}\p{N}_-]+)/gu;
const CAL_COMMAND_RE = /(^|\s)\/([\p{L}\p{N}_-]+)/gu;
const CAL_TAG_RE = /(^|\s)%([^\s%]+)/gu;
const CAL_OUTPUT_RE = /->\s*([\p{L}\p{N}_-]+)/gu;
const LOCKED_TEXT_RE = /"([^"]+)"|“([^”]+)”/g;
const PARAM_RE = /(^|\s)([\p{L}\p{N}_-]+):\s*([^\s][^\n]*?)(?=(?:\s+[\p{L}\p{N}_-]+:\s)|\s*->|$)/gu;

const TEXT_RESOURCE_PREFIXES = new Set(["copy", "brand", "text", "doc", "document"]);

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizePrompt(prompt: string) {
  return prompt
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function inferResourceType(segments: string[]): CalResourceType {
  const [head = ""] = segments;
  return TEXT_RESOURCE_PREFIXES.has(head.toLowerCase()) ? "text" : "image";
}

function parseResourceRef(rawKey: string): CalResourceRef {
  const segments = rawKey.split(".").filter(Boolean);
  const explicitBrand = segments.length > 1;
  const brandKey = explicitBrand ? segments[0] ?? "" : "";
  const pathSegments = explicitBrand ? segments.slice(1) : segments;
  const path = pathSegments.join(".");
  return {
    raw: `$${rawKey}`,
    symbol: "$",
    type: inferResourceType(pathSegments),
    brandKey,
    path,
    fullKey: rawKey,
    explicitBrand
  };
}

export function parseCalPrompt(prompt: string): CalAst {
  const normalizedPrompt = normalizePrompt(prompt);
  const agents = uniq(Array.from(normalizedPrompt.matchAll(CAL_AGENT_RE), (match) => match[2] ?? ""));
  const commands = uniq(Array.from(normalizedPrompt.matchAll(CAL_COMMAND_RE), (match) => match[2] ?? ""));
  const tags = uniq(Array.from(normalizedPrompt.matchAll(CAL_TAG_RE), (match) => match[2] ?? ""));
  const outputs = uniq(Array.from(normalizedPrompt.matchAll(CAL_OUTPUT_RE), (match) => match[1] ?? ""));
  const lockedTexts = uniq(
    Array.from(normalizedPrompt.matchAll(LOCKED_TEXT_RE), (match) => match[1] ?? match[2] ?? "")
  );

  const paramsEntries = Array.from(normalizedPrompt.matchAll(PARAM_RE), (match) => [
    match[2] ?? "",
    (match[3] ?? "").trim()
  ] as const).filter(([key, value]) => key && value);
  const params = Object.freeze(Object.fromEntries(paramsEntries));

  const resources = uniq(Array.from(normalizedPrompt.matchAll(CAL_RESOURCE_RE), (match) => match[1] ?? "")).map(parseResourceRef);

  const pipelineSteps = Math.max(0, normalizedPrompt.split(/\s*->\s*/g).length - 1);
  const warnings: string[] = [];
  if (!agents.length) warnings.push("missing-agent");
  if (!commands.length) warnings.push("missing-command");
  if (!outputs.length) warnings.push("missing-output");
  if (resources.some((resource) => !resource.path)) warnings.push("invalid-resource-path");

  return {
    version: "cal/1.0",
    originalPrompt: prompt,
    normalizedPrompt,
    agents,
    commands,
    resources,
    lockedTexts,
    tags,
    params,
    outputs,
    pipelineSteps,
    warnings
  };
}

export function stripCalSyntax(prompt: string) {
  const normalizedPrompt = normalizePrompt(prompt);
  return normalizedPrompt
    .replace(CAL_AGENT_RE, " ")
    .replace(CAL_COMMAND_RE, " ")
    .replace(CAL_RESOURCE_RE, " ")
    .replace(CAL_TAG_RE, " ")
    .replace(PARAM_RE, " ")
    .replace(CAL_OUTPUT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasCalSyntax(prompt: string) {
  const normalizedPrompt = normalizePrompt(prompt);
  return [CAL_AGENT_RE, CAL_COMMAND_RE, CAL_RESOURCE_RE, CAL_TAG_RE, CAL_OUTPUT_RE].some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalizedPrompt);
  });
}

export function summarizeCal(ast: CalAst) {
  const parts = [
    ast.agents.length ? `@${ast.agents.join(", @")}` : "",
    ast.commands.length ? `/${ast.commands.join(", /")}` : "",
    ast.resources.length ? `${ast.resources.length} resource${ast.resources.length > 1 ? "s" : ""}` : "",
    ast.outputs.length ? `-> ${ast.outputs.join(", ")}` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}
