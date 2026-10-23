import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package and release metadata use Inco identity and main branch", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const config = JSON.parse(await readFile(new URL("../.changeset/config.json", import.meta.url), "utf8"));
  assert.ok(pkg.name.endsWith("-inco"));
  assert.ok(pkg.repository.url.endsWith(`${pkg.name}.git`));
  assert.equal(config.baseBranch, "main");
  assert.equal(pkg.publishConfig.provenance, true);
  assert.ok(pkg.files.includes("src/") || pkg.files.includes("src"));
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes(`npm view ${pkg.name} version`));
  assert.ok(workflow.includes("id-token: write"));
});
