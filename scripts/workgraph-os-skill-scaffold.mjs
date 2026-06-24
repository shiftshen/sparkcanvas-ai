import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piSkillDir = path.join(root, ".pi", "skills");
const dataSkillDir = path.join(root, "data", "skills");

function safeSlug(value) {
  return String(value || "skill")
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    || "skill";
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function skillSpec(folder, json) {
  const title = json.title || folder;
  const command = json.command || `/${safeSlug(folder)}`;
  const output = json.output || (/video|视频|mp4/i.test(`${title} ${command}`) ? "MP4" : "PNG");
  const description = json.description || "由 WorkGraph OS 管理的 Pi Skill。";
  const skillJson = {
    id: json.id || `skill-${safeSlug(folder)}`,
    title,
    command,
    output,
    description,
    capabilityType: json.capabilityType || (/video|视频|mp4/i.test(`${title} ${command} ${output}`) ? "video_planning" : "image_generation"),
    runtime: json.runtime || "pi-skill",
    keywords: Array.isArray(json.keywords) ? json.keywords : [],
    version: json.version || "0.1.0",
    status: json.status || json.evolution?.status || "created"
  };
  return {
    "SKILL.md": [
      `# ${title}`,
      "",
      `Command: \`${command}\``,
      `Output: \`${output}\``,
      "",
      description,
      "",
      "## Inputs",
      "- Goal Object",
      "- Brand Object",
      "- Asset Objects",
      "- ModelPolicy",
      "",
      "## Run Contract",
      "Return ResultObject, ExecutionLog entries, and preview-ready output data.",
      "",
      "## Safety",
      "Do not overwrite user assets. Keep API keys in environment variables.",
      ""
    ].join("\n"),
    "skill.json": `${JSON.stringify(skillJson, null, 2)}\n`,
    "scripts/run.ts": [
      "export async function run(input: unknown) {",
      "  return {",
      `    skill: ${JSON.stringify(command)},`,
      "    status: \"planned\",",
      "    input",
      "  };",
      "}",
      ""
    ].join("\n"),
    "resources/guide.md": [
      `# ${title} Guide`,
      "",
      "Keep prompts, model routing, brand constraints, and output validation explicit.",
      ""
    ].join("\n"),
    "examples/input.json": `${JSON.stringify({ goal: "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频", brandId: "brand_dapot", command }, null, 2)}\n`,
    "examples/output.json": `${JSON.stringify({ resultType: output, status: "preview", logs: [] }, null, 2)}\n`
  };
}

async function ensureFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    await writeFile(filePath, content);
    return true;
  }
  return false;
}

async function syncDir(primaryDir, mirrorDir) {
  const folder = path.basename(primaryDir);
  const existingJson = await readJson(path.join(primaryDir, "skill.json"));
  const spec = skillSpec(folder, existingJson);
  let writes = 0;
  for (const dir of [primaryDir, mirrorDir]) {
    for (const [relativePath, content] of Object.entries(spec)) {
      if (await ensureFile(path.join(dir, relativePath), content)) writes += 1;
    }
    await mkdir(path.join(dir, "logs"), { recursive: true });
    await mkdir(path.join(dir, "versions"), { recursive: true });
  }
  return { folder, writes };
}

async function main() {
  await mkdir(piSkillDir, { recursive: true });
  await mkdir(dataSkillDir, { recursive: true });
  // Always ensure the canonical seed skill exists so a fresh checkout (e.g. CI,
  // where .pi/ and data/ are gitignored) can scaffold it from the template.
  const folders = new Set(["generated"]);
  for (const rootDir of [piSkillDir, dataSkillDir]) {
    for (const entry of await readdir(rootDir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) folders.add(entry.name);
    }
  }
  const results = [];
  for (const folder of [...folders].sort()) {
    results.push(await syncDir(path.join(piSkillDir, folder), path.join(dataSkillDir, folder)));
  }
  console.log(JSON.stringify({ ok: true, skills: results.length, writes: results.reduce((sum, item) => sum + item.writes, 0), folders: results.map((item) => item.folder) }, null, 2));
}

await main();
