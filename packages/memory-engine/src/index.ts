export type WorkGraphFeedbackRating = "accepted" | "needs_revision" | "failed";

export type WorkGraphFeedbackLearning = {
  shouldAvoid: boolean;
  shouldReuse: boolean;
  forbiddenRule: string;
  sceneRule: string;
  memoryReusable: boolean;
};

export type WorkGraphFeedbackMemoryInput = {
  memoryId: string;
  feedbackId: string;
  targetType: string;
  targetId: string;
  rating: WorkGraphFeedbackRating;
  action: string;
  note: string;
  brandId?: string;
  createdAt: string;
  learning: WorkGraphFeedbackLearning;
};

export type WorkGraphFeedbackMemory = {
  id: string;
  title: string;
  source: "feedback";
  sourceType: "feedback";
  sourceId: string;
  targetType: string;
  targetId: string;
  confidence: number;
  reusable: boolean;
  body: string;
  brandId?: string;
  createdAt: string;
};

export function normalizeFeedbackNote(note: string) {
  return note.trim().replace(/\s+/g, " ");
}

export function learnFromWorkGraphFeedback(note: string, rating: WorkGraphFeedbackRating): WorkGraphFeedbackLearning {
  const normalized = normalizeFeedbackNote(note);
  const negativePattern = /廉价|便宜感|cheap|低质|low quality|不适合|不符合|off-?brand|拼接|collage|文字太多|too much text|杂乱|clutter|过度复杂|complex|卡通|cartoon|脏|dirty|糊|blur/i;
  const positivePattern = /喜欢|可以复用|复用|accepted|好|适合|符合|clean|warm|trust/i;
  const shouldAvoid = rating === "failed" || rating === "needs_revision" || negativePattern.test(normalized);
  const shouldReuse = rating === "accepted" || positivePattern.test(normalized);
  return {
    shouldAvoid,
    shouldReuse,
    forbiddenRule: shouldAvoid ? `feedback avoid: ${normalized}` : "",
    sceneRule: shouldReuse ? `feedback reuse: ${normalized}` : "",
    memoryReusable: shouldAvoid || shouldReuse
  };
}

export function confidenceFromFeedbackRating(rating: WorkGraphFeedbackRating) {
  if (rating === "accepted") return 0.9;
  if (rating === "failed") return 0.75;
  return 0.7;
}

export function buildWorkGraphFeedbackMemory(input: WorkGraphFeedbackMemoryInput): WorkGraphFeedbackMemory {
  return {
    id: input.memoryId,
    title: `Feedback memory · ${input.targetType}:${input.targetId}`,
    source: "feedback",
    sourceType: "feedback",
    sourceId: input.feedbackId,
    targetType: input.targetType,
    targetId: input.targetId,
    confidence: confidenceFromFeedbackRating(input.rating),
    reusable: input.learning.memoryReusable,
    body: `${input.action}: ${normalizeFeedbackNote(input.note)}`,
    brandId: input.brandId,
    createdAt: input.createdAt
  };
}
