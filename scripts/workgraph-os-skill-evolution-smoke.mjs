import { evaluateWorkGraphSkillEvolution } from "../packages/skill-runtime/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// failure -> repair task
const fail = evaluateWorkGraphSkillEvolution({ success: false, evolution: { successCount: 5, status: "active" } });
assert(fail.repair === true && fail.status === "needs_repair" && fail.promote === false, "failed run should flag the skill for a repair task");

// success past threshold -> promote to reusable template
const promote = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 2 }, promoteThreshold: 2 });
assert(promote.promote === true && promote.template === true && promote.status === "reusable-template", "successful run past threshold should promote the skill to a reusable template");

// success below threshold -> still active
const active = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 1 }, promoteThreshold: 2 });
assert(active.promote === false && active.status === "active", "successful run below threshold should stay active");

// already a template -> no re-promote, stays template
const already = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 9, template: true } });
assert(already.promote === false && already.template === true && already.status === "reusable-template", "an existing template should not re-promote");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "skill-evolution-failure-repair",
    "skill-evolution-success-promote",
    "skill-evolution-success-active",
    "skill-evolution-template-idempotent"
  ]
}));
