import { mkdir, writeFile } from "node:fs/promises";
import path, { extname } from "node:path";

export type WorkGraphAssetKind = "image" | "video" | "document" | "audio";

export type AssetStoreConfig = {
  assetDir: string;
  now?: () => string;
  idFactory?: () => string;
};

export type StoredAssetFile = {
  kind: WorkGraphAssetKind;
  ext: string;
  relativePath: string;
  absolutePath: string;
  storedName: string;
  size: number;
  mime: string;
};

export function assetKindFromMime(mime = "", filename = ""): WorkGraphAssetKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/i.test(filename)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(filename)) return "audio";
  return "document";
}

export function assetExtFromInput(filename: string, mime = "") {
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  if (ext && /^[a-z0-9]{1,12}$/.test(ext)) return ext;
  if (mime === "image/svg+xml") return "svg";
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  if (mime.startsWith("video/")) return mime.split("/")[1];
  if (mime.startsWith("audio/")) return mime.split("/")[1];
  if (mime.includes("font")) return "font";
  return "asset";
}

export function safeAssetSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    || "asset";
}

export function isPreviewableImageAsset(stored: Pick<StoredAssetFile, "kind" | "ext">) {
  return stored.kind === "image" && ["png", "jpg", "jpeg", "webp", "svg"].includes(stored.ext);
}

export async function storeAssetBuffer(config: AssetStoreConfig, bytes: Buffer, filename: string, mime = ""): Promise<StoredAssetFile> {
  const kind = assetKindFromMime(mime, filename);
  const ext = assetExtFromInput(filename, mime);
  const date = (config.now?.() ?? new Date().toISOString()).slice(0, 10);
  const folder = `${date}/${kind}`;
  const baseName = filename.replace(/\.[^.]+$/, "");
  const storedName = `${config.idFactory?.() ?? Date.now().toString(36)}-${safeAssetSlug(baseName)}.${ext}`;
  const relativePath = `${folder}/${storedName}`;
  const absolutePath = path.join(config.assetDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return { kind, ext, relativePath, absolutePath, storedName, size: bytes.length, mime };
}
