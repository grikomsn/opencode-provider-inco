import { Money } from "@opencode/schema/money";
import { Model, Provider } from "@opencode/plugin";
import type { CatalogModel } from "./catalog.ts";

export const providerID = Provider.ID.make("inco");

export function toOpenCodeModel(model: CatalogModel): Model.Info {
  return {
    ...Model.Info.default(providerID, Model.ID.make(model.id)),
    name: model.name,
    capabilities: { tools: model.toolCalling, input: model.imageInput ? ["text", "image"] : ["text"], output: ["text"] },
    limit: { context: model.contextWindow, input: model.contextWindow - model.maxTokens, output: model.maxTokens },
    compatibility: { maxTokensField: "max_completion_tokens" },
    variants: model.efforts.map((effort) => ({ id: Model.VariantID.make(effort), body: { reasoning_effort: effort } })),
    cost: model.cost ? [{ input: Money.USDPerMillionTokens.make(model.cost.input), output: Money.USDPerMillionTokens.make(model.cost.output), cache: { read: Money.USDPerMillionTokens.make(model.cost.cacheRead ?? 0), write: Money.USDPerMillionTokens.make(0) } }] : [],
  };
}
