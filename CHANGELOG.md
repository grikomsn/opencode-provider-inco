# opencode-provider-inco

## 1.0.1

### Patch Changes

- 5f5706e: Resync the bundled Inco catalog with the live service (2026-11-09): Kimi K3 retired and left the public catalog, replaced by Kimi K3.1 Pro on both `:standard` and `:fast` routes with all seven reasoning efforts verified live.

  Catalog discovery delays now honor `Retry-After` with the same 5-second cap as the sibling providers instead of an unbounded header value.

## 1.0.0

### Major Changes

- 01d0f93: Release the stable Inco AI provider for OpenCode v2, with live model discovery, credential-scoped fallback catalogs, streaming chat, native API key authentication, and verified reasoning controls.

## 0.1.0

### Minor Changes

- Add the Inco AI provider with live model discovery, credential-scoped fallback catalogs, streaming chat, and verified reasoning controls.
