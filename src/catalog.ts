import snapshot from "./snapshot.json" with { type: "json" };

export const INCO_BASE_URL = "https://api.inco.ai/v1";
export const INCO_API_KEY_ENV = "INCO_API_KEY";
export const PROVIDER_ID = "inco";
export const PROVIDER_NAME = "Inco AI";
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export interface CatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  efforts: ReasoningEffort[];
  cost?: { input: number; output: number; cacheRead?: number };
}

/** Verified per-route effort controls from inco-copilot-chat, 2026-10-23. */
const PROFILES: Readonly<Record<string, readonly ReasoningEffort[]>> = {
  "deepseek-v4.1-flash": REASONING_EFFORTS,
  "deepseek-v4.1-flash:fast": REASONING_EFFORTS,
  "kimi-k3": ["none", "low", "high", "max"],
  "kimi-k3:fast": REASONING_EFFORTS,
  // `none`, `minimal`, `medium`, and `xhigh` are rejected with HTTP 400.
  "glm-5.3": ["low", "high", "max"],
  "glm-5.3-flash": ["low", "high", "max"],
  // `none` is accepted but does not disable reasoning on these hosted routes.
  "glm-5.3:fast": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "glm-5.3-flash:fast": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "minimax-m3.1-flash:fast": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "minimax-m3.1-flash": REASONING_EFFORTS,
};


const VERIFIED_TOOLS = new Set(Object.keys(PROFILES));

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 2 ? Math.floor(value) : fallback;
}

function price(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

/** Live lists are authoritative, including empty lists and explicit capability denials. */
export function reasoningEfforts(id: string, advertised: unknown, enabled: unknown): ReasoningEffort[] {
  if (enabled === false) return [];
  return Array.isArray(advertised)
    ? [...new Set(advertised.filter((item): item is ReasoningEffort =>
      typeof item === "string" && (REASONING_EFFORTS as readonly string[]).includes(item)))]
    : [...(PROFILES[id] ?? [])];
}

export function parseCatalog(payload: unknown): CatalogModel[] {
  const body = record(payload);
  if (!Array.isArray(body?.data)) throw new Error("Inco AI returned an invalid model catalog");
  const result = new Map<string, CatalogModel>();
  for (const raw of body.data) {
    const item = record(raw);
    if (typeof item?.id !== "string") continue;
    const id = item.id.trim();
    if (!id || /(?:^|[-/])(embed(?:ding)?s?|image|video|audio|voice|rerank)(?:[-/.]|$)/i.test(id)) continue;
    const capabilities = record(item.capabilities);
    const modalities = record(item.modalities);
    const contextWindow = positive(item.context_length, 131_072);
    const pricing = record(item.pricing);
    const input = price(pricing?.prompt ?? pricing?.input_per_1m ?? pricing?.input);
    const output = price(pricing?.completion ?? pricing?.output_per_1m ?? pricing?.output);
    const cacheRead = price(pricing?.cached_input);
    result.set(id, {
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
      contextWindow,
      maxTokens: Math.min(positive(item.max_output_tokens ?? item.max_completion_tokens, 16_384), contextWindow - 1),
      imageInput: Array.isArray(modalities?.input) && modalities.input.includes("image"),
      toolCalling: typeof (capabilities?.tool_calling ?? item.tool_calling) === "boolean"
        ? Boolean(capabilities?.tool_calling ?? item.tool_calling) : VERIFIED_TOOLS.has(id),
      efforts: reasoningEfforts(id, item.reasoning_efforts, capabilities?.reasoning_effort),
      ...(input === undefined || output === undefined ? {} : {
        cost: { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) },
      }),
    });
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export const FALLBACK_MODELS: CatalogModel[] = parseCatalog(snapshot);

export class CatalogError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Inco AI /models returned HTTP ${status}`);
    this.status = status;
    this.name = "CatalogError";
  }
  get refused(): boolean { return this.status === 401 || this.status === 403; }
}

/** No credential-bearing redirects; error bodies and account data are never logged. */
export async function fetchCatalog(apiKey: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CatalogModel[]> {
  const combined = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  for (let attempt = 0; ; attempt++) {
    combined.throwIfAborted();
    const response = await fetcher(`${INCO_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: combined,
    });
    if (attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => { clearTimeout(timer); reject(combined.reason); };
        const timer = setTimeout(() => { combined.removeEventListener("abort", abort); resolve(); }, 250 * 2 ** attempt);
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      });
      continue;
    }
    if (!response.ok) throw new CatalogError(response.status);
    return parseCatalog(await response.json());
  }
}
