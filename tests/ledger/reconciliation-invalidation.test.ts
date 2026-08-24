import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const transactionsSource = readFileSync("lib/transactions.ts", "utf8");
const importRouteSource = readFileSync("app/api/imports/route.ts", "utf8");
const importScreenSource = readFileSync("app/screens/ImportScreen.tsx", "utf8");

test("every manual ledger mutation batches its write with reconciliation invalidation", () => {
  assert.equal(
    transactionsSource.match(/await db\.batch\(/g)?.length,
    3,
    "create, update, and delete must each use one atomic D1 batch",
  );
  assert.equal(
    transactionsSource.match(/ledgerReconciledAt: null/g)?.length,
    3,
    "each manual mutation must clear the acknowledgement",
  );
  assert.match(
    transactionsSource,
    /exists\([\s\S]*?\.where\(target\)/,
    "update/delete invalidation must be conditional on an owned target row",
  );
});

test("CSV commits batch inserts, audit metadata, and conditional invalidation", () => {
  assert.match(importRouteSource, /const atomicResults = await db\.batch/);
  assert.match(importRouteSource, /ledgerReconciledAt: null/);
  assert.match(
    importRouteSource,
    /AND \$\{transactions\.id\} IN \(SELECT value FROM json_each\(\$\{pendingIdsJson\}\)\)/,
    "no-op duplicate commits must not clear reconciliation",
  );
  assert.match(importRouteSource, /if \(importable\.length === 0\)/);
  assert.match(importRouteSource, /"NO_IMPORTABLE_ROWS"/);
});

test("import acknowledgement happens after the committed ledger is inspected", () => {
  assert.doesNotMatch(importScreenSource, /ledgerReconciledAt/);
  assert.match(
    importScreenSource,
    /Commit first, inspect the resulting ledger against[\s\S]*then record a fresh acknowledgement in Settings/,
  );
});
