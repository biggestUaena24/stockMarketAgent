import assert from "node:assert/strict";
import test from "node:test";

import { quoteKeyForHolding } from "../../lib/portfolio-market-quote";
import {
  researchSymbolForHolding,
  symbolForProvider,
} from "../../lib/research/symbols";

test("TSXV holdings use the same .V canonical key for research and portfolio marks", () => {
  const holding = { symbol: "png", exchange: "TSXV" };
  const portfolioKey = quoteKeyForHolding(holding);
  const researchKey = researchSymbolForHolding(holding);

  assert.equal(portfolioKey, "PNG.V");
  assert.equal(researchKey, portfolioKey);
  assert.equal(symbolForProvider(researchKey, "alpha-vantage"), "PNG.TRV");
  assert.equal(symbolForProvider(researchKey, "fmp"), "PNG.V");
});

test("TSXV canonicalization is idempotent", () => {
  assert.equal(
    researchSymbolForHolding({ symbol: "PNG.V", exchange: "TSXV" }),
    "PNG.V",
  );
});
