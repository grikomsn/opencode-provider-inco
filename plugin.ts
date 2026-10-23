import { Plugin, Provider, Integration } from "@opencode/plugin";
import { FALLBACK_MODELS, INCO_BASE_URL, INCO_API_KEY_ENV, type CatalogModel } from "./src/catalog.ts";
import { discoverModels } from "./src/discovery.ts";
import { providerID, toOpenCodeModel } from "./src/models.ts";
import { prepareRequest } from "./src/request.ts";

export async function setup(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  const controller = new AbortController();
  let models: CatalogModel[] = [];
  let sourceConnection: Awaited<ReturnType<typeof ctx.integration.connection.active>>;
  await ctx.provider.transform((editor) => {
    editor.add({
      info: {
        ...Provider.Info.empty(providerID),
        integrationID: Integration.ID.make("inco"),
        name: "Inco AI",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: INCO_BASE_URL, timeout: 600_000, chunkTimeout: 120_000 },
      },
      models: models.map(toOpenCodeModel),
      ...(sourceConnection ? { sourceConnection } : {}),
    });
  });
  await ctx.integration.transform((editor) => {
    editor.method.update({ integrationID: "inco", method: { type: "key", label: "Inco AI API key" } });
    editor.method.update({ integrationID: "inco", method: { type: "env", names: [INCO_API_KEY_ENV] } });
  });

  let generation = 0;
  const refresh = async (): Promise<void> => {
    const current = ++generation;
    const connection = await ctx.integration.connection.active("inco");
    const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined;
    const key = credential?.type === "key" ? credential.key : process.env[INCO_API_KEY_ENV];
    const discovered = key ? await discoverModels(key, {
      read: async (scope) => { const saved = await ctx.storage.get(`catalog/${scope}`); return typeof saved === "string" ? JSON.parse(saved) : saved; },
      write: async (scope, value) => { await ctx.storage.set(`catalog/${scope}`, JSON.stringify(value)); },
    }, controller.signal) : FALLBACK_MODELS;
    if (controller.signal.aborted || current !== generation) return;
    models = discovered;
    sourceConnection = connection;
    await ctx.provider.reload();
  };
  await refresh();
  await ctx.session.hook("model.request", (event) => { event.baseURL = INCO_BASE_URL; }, { providerID: "inco" });
  await ctx.session.hook("http.request", async (event) => {
    if (event.request.url !== `${INCO_BASE_URL}/chat/completions`) throw new Error("Inco AI requires its fixed chat endpoint");
    const body = prepareRequest(await event.request.clone().json(), event.model.id, models);
    event.request = new Request(event.request, { body: JSON.stringify(body), redirect: "error" });
  }, { providerID: "inco" });

  const timer = setInterval(() => { void refresh().catch(() => {}); }, 300_000);
  timer.unref();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "credential.updated" || event.type === "credential.switched") await refresh();
      }
    } catch { /* The host closes the subscription on unload. */ }
  })();
  return () => { clearInterval(timer); controller.abort(); };
}

export default Plugin.define({ id: "inco", setup });
