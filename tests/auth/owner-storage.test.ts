import assert from "node:assert/strict";
import test from "node:test";

import { planOwnerStorageRekey } from "../../lib/owner-storage.js";

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
