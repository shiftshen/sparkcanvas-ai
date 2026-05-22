import type { MotionTokens } from "../types.js";

/**
 * Motion tokens for UI transitions and orchestration timing. Easing curves are
 * aligned with Material-style standard, emphasized, accelerate, and decelerate
 * motion guidance.
 */
export const motion = {
  duration: {
    instant: "75ms",
    fast: "150ms",
    moderate: "250ms",
    slow: "400ms",
    slower: "550ms"
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.2, 0, 0, 1.2)",
    decelerate: "cubic-bezier(0, 0, 0, 1)",
    accelerate: "cubic-bezier(0.3, 0, 1, 1)"
  }
} as const satisfies MotionTokens;

/** Motion token object type. */
export type Motion = typeof motion;
/** Motion duration token name type. */
export type MotionDurationTokenName = keyof Motion["duration"];
/** Motion easing token name type. */
export type MotionEasingTokenName = keyof Motion["easing"];
