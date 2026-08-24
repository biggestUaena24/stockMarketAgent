import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureCanonicalOwnerStorage,
  planOwnerStorageRekey,
} from "../../lib/owner-storage.js";

test("rekeys one legacy owner casing to the configured canonical key", () => {
  assert.deepEqual(
    planOwnerStorageRekey(" Owner@Example.com ", ["OWNER@example.com"]),
    {
      status: "rekey",
      fromEmail: "OWNER@example.com",
      toEmail: "owner@example.com",
    },
  );
});

test("leaves canonical or absent owner records unchanged", () => {
  assert.deepEqual(
    planOwnerStorageRekey("owner@example.com", ["owner@example.com"]),
    { status: "none" },
  );
  assert.deepEqual(planOwnerStorageRekey("owner@example.com", []), {
    status: "none",
  });
  assert.deepEqual(
    planOwnerStorageRekey("owner@example.com", ["someone@example.com"]),
    { status: "none" },
  );
});

test("fails closed when owner records span multiple casing variants", () => {
  assert.deepEqual(
    planOwnerStorageRekey("owner@example.com", [
      "Owner@example.com",
      "owner@example.com",
    ]),
    { status: "conflict" },
  );
});

test("hosted owner discovery uses bounded table reads instead of a compound SELECT", async () => {
  const statements: string[] = [];
  const fakeD1 = {
    prepare(statement: string) {
      statements.push(statement);
      return {
        async all() {
          return { results: [] };
        },
      };
    },
    async batch() {
      throw new Error("A rekey batch should not run when no owner rows exist.");
    },
  } as unknown as D1Database;

  await ensureCanonicalOwnerStorage(fakeD1, "owner@example.com");
  assert.equal(statements.length, 10);
  assert.equal(statements.some((statement) => /\bUNION\b/i.test(statement)), false);
});
