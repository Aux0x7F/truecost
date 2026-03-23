import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const mode = String(process.argv[2] || "unit").trim().toLowerCase();
const repoRoot = process.cwd();
const testDir = path.join(repoRoot, "tests");
const entries = await readdir(testDir);

const files = entries
  .filter((name) => name.endsWith(".test.mjs"))
  .filter((name) => (mode === "browser" ? name.endsWith(".browser.test.mjs") : !name.endsWith(".browser.test.mjs")))
  .sort()
  .map((name) => path.join("tests", name));

if (!files.length) {
  console.error(`No ${mode} tests matched in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
