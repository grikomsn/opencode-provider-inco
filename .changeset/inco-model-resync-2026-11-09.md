---
"opencode-provider-inco": patch
---

Resync the bundled Inco catalog with the live service (2026-11-09): Kimi K3 retired and left the public catalog, replaced by Kimi K3.1 Pro on both `:standard` and `:fast` routes with all seven reasoning efforts verified live.

Catalog discovery delays now honor `Retry-After` with the same 5-second cap as the sibling providers instead of an unbounded header value.
