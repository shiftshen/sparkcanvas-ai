// Pure, dependency-free accessors for reading fields off untyped objects.
// Extracted from server.ts (T10) so the giant server module shrinks toward
// domain-focused units; behavior is identical to the inlined originals.

export function objectField(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

export function objectString(input: unknown, key: string, fallback = "") {
  const value = objectField(input, key);
  return typeof value === "string" ? value : fallback;
}

export function objectStringArray(input: unknown, key: string) {
  const value = objectField(input, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
