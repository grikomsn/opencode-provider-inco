import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Opt-in synthetic inference: uses service credits. No request/response payloads are logged.
const host = "opencode";
const key = process.env.INCO_API_KEY;
assert.ok(key, "Set INCO_API_KEY (or run node --env-file=/path/to/.env scripts/verify-live.mjs)");
const root = await mkdtemp(join(tmpdir(), `inco-${host}-verify-`));
const source = resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
  SHELL: process.env.SHELL ?? "/bin/sh", TERM: "xterm-256color", INCO_API_KEY: key,
  PI_TELEMETRY: "0", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
};
for (const kind of ["CONFIG", "DATA", "STATE", "CACHE"]) env[`XDG_${kind}_HOME`] = join(root, kind.toLowerCase());
env.OPENCODE_CONFIG_DIR = join(root, "config", "opencode");
env.OPENCODE_TEST_HOME = join(root, "home");
env.PI_CODING_AGENT_DIR = join(root, "pi");
const binary = process.env.INCO_CLIENT_BIN ?? host;
const piArgs = ["--no-extensions", "-e", source, "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-approve", "--no-session", "--model", "inco/deepseek-v4.1-flash:fast", "--thinking", "off"];

async function run(args, timeoutMs = 120_000) {
  const child = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { errorOutput += data; });
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    assert.equal(code, 0, `${host} exited ${code}; inspect the client locally for details (output withheld)`);
    assert.ok(!/failed to load|extension error|error loading/i.test(errorOutput), "Client reported a load failure (output withheld)");
    return output;
  } finally { clearTimeout(timer); }
}

const summary = { host, model: "inco/deepseek-v4.1-flash:fast", cli: false, toolRoundTrip: false, tui: false, credentialSource: process.argv.includes("--saved-key") ? "saved" : "environment" };
const socket = `inco-verify-${process.pid}`;
const tmux = (args) => spawnSync("tmux", ["-L", socket, "-f", "/dev/null", ...args], { env, encoding: "utf8" });
try {
  for (const path of [env.OPENCODE_CONFIG_DIR, env.OPENCODE_TEST_HOME, env.PI_CODING_AGENT_DIR]) await mkdir(path, { recursive: true });
  await writeFile(join(root, "fixture.txt"), "INCO_FIXTURE_7341\n");
  await writeFile(join(root, "opencode.json"), JSON.stringify({
    plugins: [source], model: summary.model, snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "inco", effect: "allow" }],
  }));
  await writeFile(join(env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ quietStartup: true, checkForUpdates: false }));
  if (process.argv.includes("--saved-key")) {
    delete env.INCO_API_KEY;
    if (host === "pi") {
      await writeFile(join(env.PI_CODING_AGENT_DIR, "auth.json"), JSON.stringify({ inco: { type: "api_key", key } }), { mode: 0o600 });
    } else {
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
      const created = tmux(["new-session", "-d", "-s", "login", "-x", "120", "-y", "35", "-c", root,
        [binary, "auth", "login", "inco", "--standalone"].map(quote).join(" ")]);
      assert.equal(created.status, 0, "tmux is required for --saved-key with OpenCode");
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const screen = tmux(["capture-pane", "-p", "-t", "login"]).stdout ?? "";
        if (/API.key|Enter.*key/i.test(screen)) { ready = true; break; }
      }
      assert.ok(ready, "Expected the native Inco AI key prompt (output withheld)");
      const loaded = spawnSync("tmux", ["-L", socket, "load-buffer", "-"], { env, input: key });
      assert.equal(loaded.status, 0, "Could not provide the test key to the native login prompt");
      tmux(["paste-buffer", "-t", "login", "-d"]);
      tmux(["send-keys", "-t", "login", "Enter"]);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const models = await run(host === "opencode" ? ["models", "--standalone"] : [...piArgs, "--list-models", "inco"]);
  assert.ok(models.includes("deepseek-v4.1-flash:fast"), "Inco model discovery failed");
  const prompt = "Use the read tool to read fixture.txt in the current directory, then reply with its exact contents. Do not use any other files.";
  const output = await run(host === "opencode"
    ? ["run", "--standalone", "--model", `${summary.model}#none`, "--format", "json", "--title", "Inco isolated verification", prompt]
    : [...piArgs, "--tools", "read", "--mode", "json", "-p", prompt]);
  const events = output.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const tool = events.some((e) => e.type === "tool_use" || e.type === "tool_execution_end");
  const final = events.some((e) => host === "opencode"
    ? e.type === "text" && JSON.stringify(e).includes("INCO_FIXTURE_7341")
    : e.type === "message_end" && e.message?.role === "assistant" && e.message.content?.some((part) => part.type === "text" && part.text.includes("INCO_FIXTURE_7341")));
  assert.ok(tool && final, "Expected a structured tool call and a completed assistant follow-up (output withheld)");
  summary.cli = true;
  summary.toolRoundTrip = true;
  if (process.argv.includes("--tui")) {
    const prompt = "Calculate 37 multiplied by 43 and answer with just the integer.";
    const args = host === "opencode" ? ["--standalone", "--prompt", prompt] : [...piArgs, "--no-tools", prompt];
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const created = tmux(["new-session", "-d", "-s", "smoke", "-x", "140", "-y", "40", "-c", root, [binary, ...args].map(quote).join(" ")]);
    assert.equal(created.status, 0, "tmux is required for --tui");
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const screen = tmux(["capture-pane", "-p", "-t", "smoke", "-S", "-120"]).stdout ?? "";
      if (screen.includes("1591")) { summary.tui = true; break; }
    }
    assert.ok(summary.tui, "Expected the correct answer in the interactive TUI (output withheld)");
  }
  console.log(JSON.stringify(summary));
} finally {
  if (process.argv.includes("--tui") || process.argv.includes("--saved-key")) tmux(["kill-server"]);
  await rm(root, { recursive: true, force: true });
}
