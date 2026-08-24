import assert from "node:assert/strict";
import test from "node:test";

import { authoritativeFilingReference } from "../../lib/research/filings";

test("Canadian exchanges use SEDAR+ filing references", () => {
  for (const exchange of ["TSX", "TSXV"]) {
    const reference = authoritativeFilingReference(exchange, "SHOP.V");
    assert.equal(reference.provider, "SEDAR+");
    assert.equal(reference.sourceUrl, "https://www.sedarplus.ca/");
    assert.match(reference.fact, /Canadian filing reference/);
  }
});

test("United States exchanges use SEC EDGAR filing references", () => {
  const reference = authoritativeFilingReference("NASDAQ", "MSFT");
  assert.equal(reference.provider, "SEC EDGAR");
  assert.match(reference.sourceUrl, /^https:\/\/www\.sec\.gov\/edgar\//);
  assert.match(reference.sourceUrl, /MSFT/);
});
