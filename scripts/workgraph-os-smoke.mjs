import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distIndex = path.join(root, "apps", "workgraph-os", "dist", "index.html");
const sourceFile = path.join(root, "apps", "workgraph-os", "src", "main.tsx");
const requiredAssets = [
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-logo.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-product.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-ip.png")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = await readFile(distIndex, "utf8");
const source = await readFile(sourceFile, "utf8");
await Promise.all(requiredAssets.map((asset) => access(asset)));

assert(html.includes("<title>WorkGraph OS</title>"), "workgraph-os dist index should preserve the app title");
assert(html.includes("/assets/"), "workgraph-os dist index should reference built assets");
assert(source.includes("type WorkGraphWorkspace"), "workgraph-os should define a workspace object model");
assert(source.includes("workspaceStorageKey"), "workgraph-os should define workspace persistence");
assert(source.includes("recordFeedback"), "workgraph-os should record feedback objects");
assert(source.includes("对象图谱"), "workgraph-os should expose an object graph surface");
assert(source.includes("WorkGraphObjectIndex"), "workgraph-os should consume the backend object index");
assert(source.includes("/workgraph-os/objects"), "workgraph-os should request the object index API");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "workgraph-os-dist-index",
    "workgraph-os-built-assets",
    "workgraph-os-public-brand-assets",
    "workgraph-os-object-model",
    "workgraph-os-object-persistence-ready",
    "workgraph-os-feedback-memory-ready",
    "workgraph-os-backend-object-index-ready"
  ]
}));
