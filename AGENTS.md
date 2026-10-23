# Inco AI provider repository

Use Node.js 22.19+ and npm. Install with `npm ci`.

- `npm run check`: strict TypeScript and colocated Node test suites in `test/`.
- `npm run package`: verify the publishable tarball. Run both before handing off.
- Keep Inco (this independent integration) distinct from Inco AI (the service).
- Use only `https://api.inco.ai/v1` endpoints. Never log keys, prompts, tool arguments, responses, or account data.
- Keep upstream IDs, including `:fast`, verbatim. A successful live catalog replaces the previous catalog, including an empty result. Never merge stale models into live results. Refused keys must list no models.
- Reasoning effort lists from the live catalog are authoritative. Never send unsupported efforts. The bundled profiles mirror verified Copilot bridge controls.
- Test network paths with injected fakes. Live synthetic inference is opt-in and paid.
- Keep package metadata, docs, tests, and Changesets synchronized. Do not commit `.env`, `node_modules`, logs, or tarballs.
- Main branch: `main`. Public npm releases use Changesets and GitHub OIDC after npm package bootstrap and trusted-publisher configuration.
