import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function allTextFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const values = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) {
      values.push(...(await allTextFiles(child)));
    } else if (/\.(?:js|html|css|json)$/i.test(entry.name)) {
      values.push(await readFile(child, "utf8"));
    }
  }
  return values;
}

test("production bundle contains the private Cedar application", async () => {
  const builtFiles = await allTextFiles(new URL("../dist/", import.meta.url));
  const bundle = builtFiles.join("\n");
  assert.match(bundle, /Cedar TFSA Research Desk/i);
  assert.match(bundle, /A clear view before any decision/i);
  assert.match(bundle, /Run research now/i);
  assert.match(bundle, /Owner access only/i);
  assert.doesNotMatch(bundle, /Your site is taking shape|react-loading-skeleton/i);
});

test("source metadata and hosting bindings are production-safe", async () => {
  const [layout, packageJson, hosting, worker] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(layout, /\/og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(JSON.parse(hosting), {
    project_id: "appgprj_6a62d88839488191a5d2d95c6f9ce0ac",
    d1: "DB",
    r2: null,
  });
  assert.match(worker, /DB:\s*D1Database/);
  assert.doesNotMatch(worker, /\bR2Bucket\b/);
});

test("scheduled workflow preserves both Calgary-time slots", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/research-schedule.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /cron:\s*"30 7 \* \* 1-5"/);
  assert.match(workflow, /cron:\s*"30 17 \* \* 1-5"/);
  assert.equal(
    (workflow.match(/timezone:\s*"America\/Edmonton"/g) ?? []).length,
    2,
  );
  assert.match(workflow, /OAI-Sites-Authorization/);
  assert.match(workflow, /Authorization: Bearer/);
});
