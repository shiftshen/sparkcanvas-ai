import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distIndex = path.join(root, "apps", "workgraph-os", "dist", "index.html");
const requiredAssets = [
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-logo.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-product.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-ip.png")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = await readFile(distIndex, "utf8");
await Promise.all(requiredAssets.map((asset) => access(asset)));

assert(html.includes("<title>WorkGraph OS</title>"), "workgraph-os dist index should preserve the app title");
assert(html.includes("/assets/"), "workgraph-os dist index should reference built assets");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "workgraph-os-dist-index",
    "workgraph-os-built-assets",
    "workgraph-os-public-brand-assets"
  ]
}));
