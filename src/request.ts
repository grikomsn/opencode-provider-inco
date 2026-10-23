import { record, type ReasoningEffort, type CatalogModel } from "./catalog.ts";

/** Validate the final wire payload so host defaults cannot widen model effort controls. */
export function prepareRequest(payload: unknown, id: string, models: readonly CatalogModel[]): Record<string, unknown> {
  const body = record(payload);
  if (!body) throw new Error("Inco AI requires a chat request object");
  const model = models.find((m) => m.id === id);
  if (!model) throw new Error("The selected Inco AI model is unavailable; refresh the catalog");
  const result: Record<string, unknown> = { ...body, model: id };
  const requested = body.reasoning_effort;
  const effort = typeof requested === "string" && model.efforts.includes(requested as ReasoningEffort)
    ? requested : model.efforts.includes("high") ? "high" : model.efforts[0];
  if (effort) result.reasoning_effort = effort;
  else delete result.reasoning_effort;
  const tokens = Number(body.max_completion_tokens ?? body.max_tokens ?? model.maxTokens);
  result.max_completion_tokens = Number.isFinite(tokens) && tokens > 0 ? Math.min(Math.floor(tokens), model.maxTokens) : model.maxTokens;
  delete result.max_tokens;
  if (Array.isArray(body.tools) && body.tools.length && !model.toolCalling) throw new Error("This Inco AI model does not advertise tool support");
  if (id === "deepseek-v4.1-flash" && Array.isArray(body.tools) && body.tools.length
    && body.tool_choice !== undefined && body.tool_choice !== "auto" && body.tool_choice !== "none" && effort !== "none") {
    throw new Error("Standard DeepSeek requires reasoning effort none for forced tool calls; select none or the :fast route");
  }
  return result;
}
