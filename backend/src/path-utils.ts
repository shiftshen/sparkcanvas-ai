// Pure path/string helpers extracted from server.ts (T10 incremental split).

// Normalize a relative path: strip backslashes, drop empty / "." / ".." segments.
export function safeWorkGraphRelativePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}
