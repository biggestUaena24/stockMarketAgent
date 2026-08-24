import assert from "node:assert/strict";
import test from "node:test";

import {
  redactSensitiveText,
  redactStoredResearchRunSecrets,
  removeInvalidAlphaProviderCache,
} from "../../lib/secret-redaction.js";

test("redacts explicit secrets and common credential-shaped diagnostics", () => {
  const secret = "SECRETKEY123456";
  const value = redactSensitiveText(
    `API key is ${secret}; query apikey=${secret}; token sk-exampletoken123456.`,
    [secret],
  );
  assert.equal(value.includes(secret), false);
  assert.equal(value.includes("sk-exampletoken123456"), false);
  assert.match(value, /\[REDACTED\]/);
});

test("stored research diagnostics are scrubbed with bound values", async () => {
  const boundValues: unknown[][] = [];
  const statements: string[] = [];
  const fakeD1 = {
    prepare(statement: string) {
      statements.push(statement);
      return {
        bind(...values: unknown[]) {
          boundValues.push(values);
          return { statement, values };
        },
      };
    },
    async batch(values: unknown[]) {
      return values.map(() => ({ success: true }));
    },
  } as unknown as D1Database;

  await redactStoredResearchRunSecrets(fakeD1, ["secret-one", "secret-two"]);
  assert.equal(statements.length, 2);
  assert.equal(statements.every((statement) => /research_runs/.test(statement)), true);
  assert.deepEqual(boundValues, [
    ["secret-one", "secret-one"],
    ["secret-two", "secret-two"],
  ]);
});

test("invalid Alpha payload cache cleanup targets provider error objects", async () => {
  let statement = "";
  let ran = false;
  const fakeD1 = {
    prepare(value: string) {
      statement = value;
      return {
        async run() {
          ran = true;
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;

  await removeInvalidAlphaProviderCache(fakeD1);
  assert.equal(ran, true);
  assert.match(statement, /DELETE FROM provider_cache/);
  assert.match(statement, /alpha-vantage/);
  assert.match(statement, /Information/);
});
