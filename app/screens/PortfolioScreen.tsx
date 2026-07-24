"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/app/components/icons";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Metric,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import {
  apiRequest,
  dateTime,
  money,
  percent,
  useApi,
} from "@/app/lib/client";
import type {
  DashboardPayload,
  TransactionsPayload,
} from "@/app/lib/view-types";

const actions = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "FEE",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "FX_CONVERSION",
] as const;

export function PortfolioScreen() {
  const dashboard = useApi<DashboardPayload>("/api/dashboard");
  const ledger = useApi<TransactionsPayload>("/api/transactions");
  const [formOpen, setFormOpen] = useState(false);
  const [action, setAction] = useState<(typeof actions)[number]>("BUY");
  const [currency, setCurrency] = useState<"CAD" | "USD">("CAD");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cashAction = useMemo(
    () =>
      action === "CONTRIBUTION" ||
      action === "WITHDRAWAL" ||
      action === "FEE" ||
      action === "FX_CONVERSION",
    [action],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const occurredAt = String(form.get("occurredAt") ?? "");
    try {
      await apiRequest("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          action,
          canonicalSymbol: cashAction
            ? "CASH"
            : String(form.get("canonicalSymbol") ?? ""),
          exchange: cashAction
            ? "CASH"
            : String(form.get("exchange") ?? ""),
          quantity: Number(form.get("quantity")),
          price: Number(form.get("price")),
          currency,
          fee: Number(form.get("fee") ?? 0),
          fxRateToCad: Number(form.get("fxRateToCad") ?? 1),
          occurredAt: new Date(occurredAt).toISOString(),
          notes: String(form.get("notes") ?? ""),
        }),
      });
      setMessage("Transaction saved. Portfolio math has been recalculated.");
      setFormOpen(false);
      await Promise.all([ledger.reload(), dashboard.reload()]);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Unable to save transaction.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this transaction from the ledger?")) return;
    setMessage(null);
    try {
      await apiRequest(`/api/transactions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setMessage("Transaction removed and calculations refreshed.");
      await Promise.all([ledger.reload(), dashboard.reload()]);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Unable to remove transaction.",
      );
    }
  }

  const loading = dashboard.loading || ledger.loading;
  const error = dashboard.error ?? ledger.error;
  const portfolio = dashboard.data?.portfolio;

  return (
    <>
      <PageHeader
        eyebrow="Deterministic portfolio accounting"
        title="Portfolio ledger"
        description="Record actual Wealthsimple fills, fees, FX rates, dividends, contributions, and withdrawals. Research never changes these numbers."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={() => setFormOpen((value) => !value)}
          >
            <Icon name={formOpen ? "close" : "plus"} width={17} height={17} />
            {formOpen ? "Close form" : "Add transaction"}
          </button>
        }
      />

      {message ? (
        <Notice
          title={message}
          tone={message.includes("Unable") || message.includes("must") ? "warning" : "quiet"}
          icon={message.includes("Unable") ? "warning" : "check"}
        >
          <p>Wealthsimple remains the source of truth; reconcile after edits.</p>
        </Notice>
      ) : null}

      {formOpen ? (
        <Card className="transaction-form-card">
          <CardHeader
            title="Record an actual transaction"
            description="Use the final filled price from Wealthsimple, not a recommendation price."
          />
          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              <span>Action</span>
              <select
                name="action"
                value={action}
                onChange={(event) =>
                  setAction(event.target.value as (typeof actions)[number])
                }
              >
                {actions.map((item) => (
                  <option key={item} value={item}>
                    {humanAction(item)}
                  </option>
                ))}
              </select>
            </label>
            {!cashAction ? (
              <>
                <label className="field">
                  <span>Ticker</span>
                  <input
                    name="canonicalSymbol"
                    placeholder="e.g. SHOP or VFV"
                    required
                    autoCapitalize="characters"
                  />
                </label>
                <label className="field">
                  <span>Exchange</span>
                  <select name="exchange" defaultValue="TSX">
                    <option>TSX</option>
                    <option>NYSE</option>
                    <option>NASDAQ</option>
                    <option>TSXV</option>
                  </select>
                </label>
              </>
            ) : null}
            <label className="field">
              <span>{cashAction ? "Units" : "Shares"}</span>
              <input
                name="quantity"
                type="number"
                min="0"
                step="0.00000001"
                defaultValue={cashAction ? "1" : ""}
                required
              />
            </label>
            <label className="field">
              <span>
                {action === "CONTRIBUTION" || action === "WITHDRAWAL"
                  ? "Amount"
                  : action === "DIVIDEND"
                    ? "Gross amount per unit"
                    : "Filled price"}
              </span>
              <input
                name="price"
                type="number"
                min="0"
                step="0.000001"
                required
              />
            </label>
            <label className="field">
              <span>Currency</span>
              <select
                name="currency"
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value as "CAD" | "USD")
                }
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="field">
              <span>Trading fee</span>
              <input
                name="fee"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </label>
            <label className="field">
              <span>CAD per currency unit</span>
              <input
                key={currency}
                name="fxRateToCad"
                type="number"
                min="0.01"
                step="0.000001"
                defaultValue={currency === "CAD" ? "1" : "1.35"}
                required
              />
              <small>
                Use 1 for CAD. For USD, copy the trade-time exchange rate.
              </small>
            </label>
            <label className="field">
              <span>Date and time</span>
              <input
                name="occurredAt"
                type="datetime-local"
                defaultValue={localDateTimeValue()}
                required
              />
            </label>
            <label className="field field-span-2">
              <span>Note</span>
              <input
                name="notes"
                placeholder="Optional reconciliation note"
                maxLength={500}
              />
            </label>
            <div className="form-actions field-span-2">
              <button className="button button-primary" disabled={saving}>
                {saving ? "Saving…" : "Save actual transaction"}
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <LoadingBlock rows={6} />
      ) : error || !portfolio || !ledger.data ? (
        <ErrorState
          message={error ?? "Ledger data is unavailable."}
          onRetry={() => {
            void dashboard.reload();
            void ledger.reload();
          }}
        />
      ) : (
        <div className="page-stack">
          <section className="metric-grid metric-grid-three">
            <Metric
              label="Estimated liquidation"
              value={money(portfolio.estimatedLiquidationValueCad)}
              detail="Includes modeled sale-side USD FX cost where applicable."
              icon="wallet"
            />
            <Metric
              label="Realized gain"
              value={money(portfolio.totals.realizedGainCad)}
              detail={`${money(portfolio.totals.netDividendsCad)} net dividends tracked`}
              icon="portfolio"
              tone={portfolio.totals.realizedGainCad >= 0 ? "good" : "watch"}
            />
            <Metric
              label="Tracked costs"
              value={money(
                portfolio.totals.tradeFeesCad +
                  portfolio.totals.fxFeesCad +
                  portfolio.totals.explicitFeesCad,
              )}
              detail={`${money(portfolio.totals.fxFeesCad)} modeled Wealthsimple FX fees`}
              icon="document"
            />
          </section>

          <Notice title="Returns are shown in two lenses" tone="quiet">
            <p>
              Native-currency return shows the security itself. CAD return also
              reflects recorded exchange rates and the modeled Wealthsimple
              conversion fee. Current values use ledger prices until a fresh
              provider quote is available.
            </p>
          </Notice>

          <Card>
            <CardHeader
              title="Open positions"
              description={portfolio.valuationLabel}
              action={
                <Badge tone={portfolio.errors.length ? "watch" : "good"}>
                  {portfolio.errors.length
                    ? `${portfolio.errors.length} reconciliation issue`
                    : "Ledger balanced"}
                </Badge>
              }
            />
            {portfolio.holdings.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Security</th>
                      <th className="number">Shares</th>
                      <th className="number">Average cost</th>
                      <th className="number">Ledger value</th>
                      <th className="number">Native return</th>
                      <th className="number">CAD return</th>
                      <th className="number">Allocation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((holding) => (
                      <tr key={holding.key}>
                        <td>
                          <strong>{holding.symbol}</strong>
                          <span className="cell-subtitle">
                            {holding.exchange} · {holding.currency}
                          </span>
                        </td>
                        <td className="number">
                          {holding.quantity.toLocaleString("en-CA", {
                            maximumFractionDigits: 8,
                          })}
                        </td>
                        <td className="number">
                          {money(holding.averageCostNative, holding.currency)}
                        </td>
                        <td className="number">
                          <strong>{money(holding.estimatedLiquidationValueCad)}</strong>
                          <span className="cell-subtitle">
                            mark {money(holding.markedPriceNative, holding.currency)}
                          </span>
                        </td>
                        <td
                          className={`number ${
                            (holding.unrealizedReturnPctNative ?? 0) >= 0
                              ? "value-positive"
                              : "value-negative"
                          }`}
                        >
                          {percent(holding.unrealizedReturnPctNative)}
                        </td>
                        <td
                          className={`number ${
                            (holding.unrealizedReturnPctCad ?? 0) >= 0
                              ? "value-positive"
                              : "value-negative"
                          }`}
                        >
                          {percent(holding.unrealizedReturnPctCad)}
                        </td>
                        <td className="number">
                          {percent(holding.allocationPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="portfolio"
                title="No positions yet"
                description="Add an opening buy or import a Wealthsimple holdings CSV."
                action={
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setFormOpen(true)}
                  >
                    Add a transaction
                  </button>
                }
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Transaction history"
              description="Newest first · raw CSV files are never retained"
              action={<Badge>{ledger.data.transactions.length} entries</Badge>}
            />
            {ledger.data.transactions.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Security</th>
                      <th className="number">Quantity</th>
                      <th className="number">Price / amount</th>
                      <th className="number">Fee</th>
                      <th className="number">FX to CAD</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{dateTime(transaction.occurredAt)}</td>
                        <td>
                          <Badge tone={transaction.action === "SELL" ? "watch" : "neutral"}>
                            {humanAction(transaction.action)}
                          </Badge>
                        </td>
                        <td>
                          <strong>{transaction.canonicalSymbol}</strong>
                          <span className="cell-subtitle">{transaction.exchange}</span>
                        </td>
                        <td className="number">{transaction.quantity}</td>
                        <td className="number">
                          {money(transaction.price, transaction.currency)}
                        </td>
                        <td className="number">
                          {money(transaction.fee, transaction.currency)}
                        </td>
                        <td className="number">
                          {transaction.fxRateToCad.toFixed(4)}
                        </td>
                        <td className="row-action-cell">
                          <button
                            className="icon-button icon-button-danger"
                            type="button"
                            onClick={() => remove(transaction.id)}
                            aria-label={`Remove ${transaction.action} transaction`}
                          >
                            <Icon name="trash" width={16} height={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="document"
                title="No ledger history"
                description="Start with an opening position, cash contribution, or CSV preview."
              />
            )}
          </Card>

          {portfolio.errors.length ? (
            <Notice title="Ledger reconciliation issues" tone="warning" icon="warning">
              <ul className="compact-list">
                {portfolio.errors.slice(0, 6).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      )}
    </>
  );
}

function humanAction(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function localDateTimeValue(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
