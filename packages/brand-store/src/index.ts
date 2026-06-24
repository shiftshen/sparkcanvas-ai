import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type WorkGraphBrandRecord = {
  id: string;
  name: string;
  context: string;
  positioning?: string;
  colors?: string;
  audience?: string;
  rules?: string[];
  forbiddenWords?: string[];
  dislikedPatterns?: string[];
  assetRoles?: unknown[];
  assets?: unknown[];
  updatedAt?: string;
  source?: string;
  [key: string]: unknown;
};

export type BrandStoreConfig = {
  brandDir: string;
};

export function brandStoreSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    || "brand";
}

export function brandStorePath(config: BrandStoreConfig, brandId: string) {
  return path.join(config.brandDir, `${brandStoreSlug(brandId)}.json`);
}

export async function writeBrandRecord(config: BrandStoreConfig, brand: WorkGraphBrandRecord) {
  await mkdir(config.brandDir, { recursive: true });
  const filePath = brandStorePath(config, brand.id);
  await writeFile(filePath, `${JSON.stringify({ ...brand, storedAt: new Date().toISOString() }, null, 2)}\n`);
  return filePath;
}

export async function syncBrandRecords(config: BrandStoreConfig, brands: WorkGraphBrandRecord[]) {
  const files: string[] = [];
  for (const brand of brands) {
    files.push(await writeBrandRecord(config, brand));
  }
  return files;
}

export async function readBrandRecord(config: BrandStoreConfig, brandId: string) {
  const filePath = brandStorePath(config, brandId);
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as WorkGraphBrandRecord;
}

export async function listBrandRecords(config: BrandStoreConfig) {
  try {
    const entries = await readdir(config.brandDir, { withFileTypes: true });
    const brands: WorkGraphBrandRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      brands.push(JSON.parse(await readFile(path.join(config.brandDir, entry.name), "utf8")) as WorkGraphBrandRecord);
    }
    return brands;
  } catch {
    return [];
  }
}
