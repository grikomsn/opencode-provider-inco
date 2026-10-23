import assert from "node:assert/strict";
import { test } from "node:test";
import { Plugin } from "@opencode/plugin";
import localEntry from "../index.ts";
import { setup } from "../plugin.ts";
import { toOpenCodeModel } from "../src/models.ts";
import { FALLBACK_MODELS } from "../src/catalog.ts";

test("v2 models preserve upstream IDs, price units, exact variants and output reserve", () => {
  const model = toOpenCodeModel(FALLBACK_MODELS.find((m) => m.id === "glm-5.3")!);
  assert.equal(model.modelID, "glm-5.3");
  assert.deepEqual(model.variants.map((v) => v.id), ["low", "high", "max"]);
  assert.equal(model.cost[0]!.input, 1.4);
  assert.equal(model.limit.input! + model.limit.output, model.limit.context);
});
test("v2 lifecycle registers native integration, fixed endpoint hooks and unload cleanup", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ id: "one" }] }));
  const old = process.env.INCO_API_KEY;
  process.env.INCO_API_KEY = "test-key";
  let transform: ((editor: unknown) => void) | undefined;
  let added: { models: { id: string }[]; info: { package: string; settings: { baseURL: string } } } | undefined;
  let methods = 0;
  const hooks: string[] = [];
  const ctx = {
    provider: { transform: async (f: typeof transform) => { transform = f; }, reload: async () => {
      transform!({ add: (value: typeof added) => { added = value; } });
    } },
    integration: { transform: async (f: (e: unknown) => void) => f({ method: { update: () => { methods++; } } }), connection: { active: async () => undefined } },
    storage: { get: async () => undefined, set: async () => {} },
    session: { hook: async (name: string) => { hooks.push(name); } },
    event: { subscribe: async function* () {} },
  } as unknown as Plugin.Context;
  try {
    const cleanup = await setup(ctx);
    assert.equal(methods, 2);
    assert.deepEqual(added!.models.map((m) => m.id), ["one"]);
    assert.equal(added!.info.package, "@opencode/ai/providers/openai-compatible");
    assert.equal(added!.info.settings.baseURL, "https://api.inco.ai/v1");
    assert.deepEqual(hooks, ["model.request", "http.request"]);
    await cleanup();
  } finally { if (old === undefined) delete process.env.INCO_API_KEY; else process.env.INCO_API_KEY = old; }
});

test("local directory entry exposes the v2 plugin definition", () => {
  assert.equal(localEntry.id, "inco");
  assert.equal(localEntry.setup, setup);
});
