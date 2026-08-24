import assert from "node:assert/strict";
import test from "node:test";

import {
  redactSensitiveText,
  redactStoredResearchRunSecrets,
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
