import { describe, expect, it } from "vitest";
import { evaluateWorkGraphSkillEvolution } from "../index.js";

describe("evaluateWorkGraphSkillEvolution", () => {
  it("flags a failed run for repair", () => {
    const decision = evaluateWorkGraphSkillEvolution({ success: false, evolution: { successCount: 9, status: "active" } });
    expect(decision.repair).toBe(true);
    expect(decision.promote).toBe(false);
    expect(decision.status).toBe("needs_repair");
  });

  it("promotes to a reusable template once the success threshold is reached", () => {
    const decision = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 2 }, promoteThreshold: 2 });
    expect(decision.promote).toBe(true);
    expect(decision.template).toBe(true);
    expect(decision.status).toBe("reusable-template");
  });

  it("stays active below the threshold", () => {
    const decision = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 1 }, promoteThreshold: 2 });
    expect(decision.promote).toBe(false);
    expect(decision.status).toBe("active");
  });

  it("does not re-promote an existing template", () => {
    const decision = evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 9, template: true } });
    expect(decision.promote).toBe(false);
    expect(decision.template).toBe(true);
    expect(decision.status).toBe("reusable-template");
  });

  it("defaults the threshold to 2 and clamps to >= 1", () => {
    expect(evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 1 } }).promote).toBe(false);
    expect(evaluateWorkGraphSkillEvolution({ success: true, evolution: { successCount: 1 }, promoteThreshold: 0 }).promote).toBe(true);
  });
});
