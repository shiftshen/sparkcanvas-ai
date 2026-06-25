// Pure SQLite literal encoders used to build the WorkGraph OS export script.
// Extracted from server.ts (T10); behavior identical to the inlined originals.

export function sqliteSqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqliteSqlValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return sqliteSqlString(String(value));
}

export function sqliteJson(value: unknown) {
  return JSON.stringify(value ?? null);
}
