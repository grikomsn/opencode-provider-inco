import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_MODELS, CatalogError, fetchCatalog, parseCatalog, reasoningEfforts } from "../src/catalog.ts";
import { discoverModels, credentialScope, catalogPayload, type CatalogStorage } from "../src/discovery.ts";
import { prepareRequest } from "../src/request.ts";

function memory(): CatalogStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, read: async (key) => data.get(key), write: async (key, value) => { data.set(key, value); } };
}
const live = { data: [{ id: "glm-5.3:fast", name: "Live name", context_length: 10000,
  max_output_tokens: 2000, reasoning_efforts: ["low"], capabilities: { tool_calling: false },
  pricing: { input: "0.15", output: 0.5, cached_input: 0.03 }, modalities: { input: ["text"] } }] };
const unavailable: typeof fetch = async () => { throw new TypeError("fetch failed"); };

test("bundled public catalog has ten routes, verbatim fast IDs and bounded output", () => {
  assert.equal(FALLBACK_MODELS.length, 10);
  assert.equal(FALLBACK_MODELS.filter((m) => m.id.endsWith(":fast")).length, 5);
  assert.ok(FALLBACK_MODELS.every((m) => m.maxTokens === 16384 && m.toolCalling));
});
test("live metadata overrides profiles, preserves prices per million, and does not widen capabilities", () => {
  const [m] = parseCatalog(live);
  assert.equal(m!.name, "Live name");
  assert.deepEqual(m!.efforts, ["low"]);
  assert.equal(m!.toolCalling, false);
  assert.equal(m!.contextWindow, 10000);
  assert.equal(m!.maxTokens, 2000);
  assert.deepEqual(m!.cost, { input: 0.15, output: 0.5, cacheRead: 0.03 });
  assert.deepEqual(parseCatalog(catalogPayload([m!])), [m]);
});
test("explicit empty efforts and disabled reasoning stay disabled", () => {
  assert.deepEqual(reasoningEfforts("glm-5.3", [], true), []);
  assert.deepEqual(reasoningEfforts("glm-5.3", ["high"], false), []);
  assert.deepEqual(reasoningEfforts("unknown", undefined, true), []);
  assert.deepEqual(reasoningEfforts("glm-5.3", undefined, true), ["low", "high", "max"]);
});
test("malformed entries, non-chat routes, deduplication, empty and invalid catalogs", () => {
  assert.deepEqual(parseCatalog({ data: [null, [], {}, { id: " " }, { id: "text-embedding-3" }] }), []);
  assert.equal(parseCatalog({ data: [{ id: "x" }, { id: "x", name: "last" }] })[0]!.name, "last");
  assert.deepEqual(parseCatalog({ data: [] }), []);
  assert.throws(() => parseCatalog({ models: [] }), /invalid/);
  assert.equal(parseCatalog({ data: [{ id: "x", context_length: 2 }] })[0]!.maxTokens, 1);
});
test("catalog requests fix endpoint and auth, reject redirects and honor cancellation", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.inco.ai/v1/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key");
    assert.equal(init?.redirect, "error");
    return Response.json(live);
  };
  assert.equal((await fetchCatalog("synthetic-key", undefined, fetcher)).length, 1);
  const signal = AbortSignal.abort();
  await assert.rejects(fetchCatalog("synthetic-key", signal, fetcher), { name: "AbortError" });
});
test("discovery replaces stale inventories and preserves successful emptiness", async () => {
  const storage = memory();
  await storage.write(credentialScope("a"), catalogPayload(FALLBACK_MODELS));
  const selected = await discoverModels("a", storage, undefined, async () => Response.json(live));
  assert.deepEqual(selected.map((m) => m.id), ["glm-5.3:fast"]);
  assert.deepEqual(await discoverModels("a", storage, undefined, async () => Response.json({ data: [] })), []);
  assert.deepEqual(await discoverModels("a", storage, undefined, unavailable), []);
});
test("401 and 403 clear matching cache; no body content appears in errors", async () => {
  for (const status of [401, 403]) {
    const storage = memory();
    await storage.write(credentialScope("a"), catalogPayload(FALLBACK_MODELS));
    assert.deepEqual(await discoverModels("a", storage, undefined, async () => new Response("private error", { status })), []);
    assert.deepEqual(await discoverModels("a", storage, undefined, unavailable), []);
    await assert.rejects(fetchCatalog("a", undefined, async () => new Response("private error", { status })), (error) => error instanceof CatalogError && !error.message.includes("private"));
  }
});
test("outage caches are credential scoped and persisted metadata contains no keys", async () => {
  const storage = memory();
  const a = await discoverModels("secret-a", storage, undefined, async () => Response.json(live));
  assert.deepEqual(await discoverModels("secret-a", storage, undefined, unavailable), a);
  assert.deepEqual(await discoverModels("secret-b", storage, undefined, unavailable), FALLBACK_MODELS);
  assert.ok(!JSON.stringify([...storage.data]).includes("secret-a"));
  assert.notEqual(credentialScope("secret-a"), credentialScope("secret-b"));
});
test("only transient catalog HTTP failures retry; inference streaming is owned by host", async () => {
  let calls = 0;
  await fetchCatalog("a", undefined, async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json(live));
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchCatalog("a", undefined, async () => { calls++; return new Response(null, { status: 400 }); }));
  assert.equal(calls, 1);
});
test("wire requests clamp output and unsupported efforts without inventing controls", () => {
  const models = parseCatalog(live);
  const body = prepareRequest({ reasoning_effort: "medium", max_tokens: 9000 }, "glm-5.3:fast", models);
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_completion_tokens, 2000);
  assert.ok(!("max_tokens" in body));
  assert.throws(() => prepareRequest({ tools: [{}] }, "glm-5.3:fast", models), /tool support/);
  const unknown = prepareRequest({ reasoning_effort: "high" }, "new-model", parseCatalog({ data: [{ id: "new-model" }] }));
  assert.ok(!("reasoning_effort" in unknown));
  assert.throws(() => prepareRequest({}, "removed", models), /unavailable/);
});
test("standard DeepSeek rejects forced tools with thinking and accepts verified none", () => {
  assert.throws(() => prepareRequest({ tools: [{}], tool_choice: "required" }, "deepseek-v4.1-flash", FALLBACK_MODELS), /forced tool/);
  assert.equal(prepareRequest({ tools: [{}], tool_choice: "required", reasoning_effort: "none" }, "deepseek-v4.1-flash", FALLBACK_MODELS).reasoning_effort, "none");
  assert.doesNotThrow(() => prepareRequest({ tools: [{}], tool_choice: "auto" }, "deepseek-v4.1-flash", FALLBACK_MODELS));
});
