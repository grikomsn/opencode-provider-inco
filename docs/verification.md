# Bootstrap verification

Verified on 2026-10-24 (Asia/Jakarta) with Node.js 24.18.0, OpenCode 2.1.4, and pi 1.4.0.

- Strict TypeScript checks and all 15 injected-fake tests passed.
- `npm run package` verified the publishable file list.
- The real opencode CLI loaded this checkout, discovered Inco AI routes, streamed a structured read-tool call, and completed an assistant follow-up with the synthetic fixture contents.
- The real opencode TUI ran in a separate tmux server using temporary configuration and state, and returned the correct answer to a synthetic arithmetic request.
- A live synthetic rejected-key check returned no models, including any built-in source entries.
- A real OpenCode API-key login followed by inference succeeded with `INCO_API_KEY` absent from the client environment.
- Inference used `inco/deepseek-v4.1-flash:fast` with reasoning disabled for CLI tool checks. No personal projects or existing client sessions were used as inference context.

The live checks cover this route and these flows. Per-model effort restrictions, refusal handling, catalog replacement, credential isolation, output limits, and cancellation are additionally covered with fakes. They do not establish live behavior of every catalog route or Inco AI's account-side retention policy.

Reproduce with `node --env-file=/path/to/.env scripts/verify-live.mjs --saved-key --tui`. This spends service credits and requires the client executable and tmux. The script suppresses provider payloads and prints pass/fail metadata only.
