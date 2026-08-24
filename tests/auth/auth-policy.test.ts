import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalOwnerStorageKey,
  constantTimeEqual,
  evaluateOwnerStatus,
} from "../../lib/auth-policy";

test("allows exactly the configured owner and normalizes email casing", () => {
  assert.equal(
    canonicalOwnerStorageKey(" Owner@Example.com "),
    "owner@example.com",
  );
  assert.equal(
    evaluateOwnerStatus({
      userEmail: " Owner@Example.com ",
      configuredOwnerEmail: "owner@example.com",
      localDevelopment: false,
    }),
    "authorized",
  );
  assert.equal(
    evaluateOwnerStatus({
      userEmail: "other@example.com",
      configuredOwnerEmail: "owner@example.com",
      localDevelopment: false,
    }),
    "forbidden",
  );
});

test("fails closed for missing identity or production owner configuration", () => {
  assert.equal(
    evaluateOwnerStatus({
      userEmail: null,
      configuredOwnerEmail: "owner@example.com",
      localDevelopment: false,
    }),
    "unauthenticated",
  );
  assert.equal(
    evaluateOwnerStatus({
      userEmail: "owner@example.com",
      configuredOwnerEmail: null,
      localDevelopment: false,
    }),
    "owner_unconfigured",
  );
  assert.equal(
    evaluateOwnerStatus({
      userEmail: null,
      configuredOwnerEmail: null,
      localDevelopment: true,
    }),
    "authorized",
  );
});

test("machine-token comparison rejects missing, altered, and truncated values", () => {
  const token = "scheduled-secret-with-enough-entropy";
  assert.equal(constantTimeEqual(token, token), true);
  assert.equal(constantTimeEqual(token, ""), false);
  assert.equal(constantTimeEqual(token, `${token}x`), false);
  assert.equal(constantTimeEqual(token, token.slice(0, -1)), false);
  assert.equal(
    constantTimeEqual(token, "scheduled-secret-with-enough-entropz"),
    false,
  );
});
