"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/app/components/icons";
import {
  Badge,
  Card,
  CardHeader,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import {
  apiRequest,
  dateTime,
  money,
  useApi,
} from "@/app/lib/client";
import type { OwnerSettings, ProviderMode } from "@/lib/settings";

type SettingsPayload = {
  settings: OwnerSettings;
};

export function SettingsScreen() {
  const settingsApi = useApi<SettingsPayload>("/api/settings");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  async function save(
    payload: Record<string, unknown>,
  ): Promise<void> {
    setSaving(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const updated = await apiRequest<SettingsPayload>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      settingsApi.setData(updated);
      setMessage(
        "Settings saved. Research and readiness gates now use this profile.",
      );
    } catch (caught) {
      setMessageIsError(true);
      setMessage(
        caught instanceof Error ? caught.message : "Unable to save settings.",
      );
      throw caught;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Owner-controlled safety profile"
        title="Settings and guardrails"
        description="Set the limits that research must respect. These values do not connect to CRA or Wealthsimple, and no setting authorizes an automatic trade."
        action={
          <button
            className="button button-primary"
            type="submit"
            form="owner-settings-form"
            disabled={saving || !settingsApi.data}
          >
            <Icon name={saving ? "refresh" : "check"} width={17} height={17} />
            {saving ? "Saving…" : "Save settings"}
          </button>
        }
      />

      {message ? (
        <Notice
          title={message}
          tone={messageIsError ? "warning" : "quiet"}
          icon={messageIsError ? "warning" : "check"}
        >
          <p>
            {messageIsError
              ? "Nothing was changed. Review the highlighted limits and try again."
              : "Wealthsimple and CRA records remain the sources of truth."}
          </p>
        </Notice>
      ) : null}

      {settingsApi.loading ? (
        <LoadingBlock rows={8} />
      ) : settingsApi.error || !settingsApi.data ? (
        <ErrorState
          message={settingsApi.error ?? "Settings are unavailable."}
          onRetry={settingsApi.reload}
        />
      ) : (
        <SettingsForm
          key={settingsApi.data.settings.updatedAt}
          settings={settingsApi.data.settings}
          saving={saving}
          onSave={save}
          onValidationError={(validationMessage) => {
            setMessageIsError(true);
            setMessage(validationMessage);
          }}
        />
      )}
    </>
  );
}

function SettingsForm({
  settings,
  saving,
  onSave,
  onValidationError,
}: {
  settings: OwnerSettings;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onValidationError: (message: string) => void;
}) {
  const [providerMode, setProviderMode] = useState<ProviderMode>(
    settings.providerMode,
  );
  const [emergencyFundConfirmed, setEmergencyFundConfirmed] = useState(
    settings.emergencyFundConfirmed,
  );
  const [usdAccountEnabled, setUsdAccountEnabled] = useState(
    settings.usdAccountEnabled,
  );
  const [quoteEntitlementVerified, setQuoteEntitlementVerified] = useState(
    settings.quoteEntitlementVerified,
  );
  const [liveLabelsAcknowledged, setLiveLabelsAcknowledged] = useState(
    settings.liveLabelsAcknowledged,
  );
  const [onboardingComplete, setOnboardingComplete] = useState(
    settings.onboardingComplete,
  );
  const [ledgerReconciled, setLedgerReconciled] = useState(
    Boolean(settings.ledgerReconciledAt),
  );
  const [paperTrialStarted, setPaperTrialStarted] = useState(
    Boolean(settings.paperTrialStartedAt),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      const horizonYears = requiredNumber(form, "horizonYears");
      const lossTolerancePct = requiredNumber(form, "lossTolerancePct");
      const tfsaRoomEstimateCad = requiredNumber(
        form,
        "tfsaRoomEstimateCad",
      );
      const availableCashCad = requiredNumber(form, "availableCashCad");
      const etfCoreTargetPct = requiredNumber(form, "etfCoreTargetPct");
      const individualStocksMaxPct = requiredNumber(
        form,
        "individualStocksMaxPct",
      );
      const singleStockMaxPct = requiredNumber(form, "singleStockMaxPct");
      const watchlist = normalizedSymbols(String(form.get("watchlist") ?? ""));
      const exclusions = normalizedList(String(form.get("exclusions") ?? ""));

      if (etfCoreTargetPct + individualStocksMaxPct > 100) {
        throw new Error(
          "ETF core target plus the individual-stock maximum cannot exceed 100%.",
        );
      }
      if (singleStockMaxPct > individualStocksMaxPct) {
        throw new Error(
          "The single-stock maximum cannot exceed the total individual-stock limit.",
        );
      }
      const watchlistLimit = providerMode === "trial" ? 4 : 25;
      if (watchlist.length > watchlistLimit) {
        throw new Error(
          `${providerMode === "trial" ? "Trial mode" : "Full mode"} supports at most ${watchlistLimit} watchlist symbols.`,
        );
      }
      if (onboardingComplete && !emergencyFundConfirmed) {
        throw new Error(
          "Confirm an emergency fund before marking onboarding complete.",
        );
      }
      if (
        paperTrialStarted &&
        (!onboardingComplete || !ledgerReconciled)
      ) {
        throw new Error(
          "Complete onboarding and reconcile the ledger before starting the paper trial.",
        );
      }
      if (
        settings.paperTrialStartedAt &&
        !paperTrialStarted &&
        !window.confirm(
          "Reset the paper-trial start date? Existing paper decisions remain, but the readiness clock restarts.",
        )
      ) {
        return;
      }

      await onSave({
        horizonYears,
        lossTolerancePct,
        emergencyFundConfirmed,
        usdAccountEnabled,
        tfsaRoomEstimateCad,
        availableCashCad,
        exclusions,
        watchlist,
        etfCoreTargetPct,
        individualStocksMaxPct,
        singleStockMaxPct,
        providerMode,
        quoteEntitlementVerified:
          providerMode === "full" && quoteEntitlementVerified,
        liveLabelsAcknowledged,
        onboardingComplete,
        ledgerReconciledAt: ledgerReconciled
          ? (settings.ledgerReconciledAt ?? new Date().toISOString())
          : null,
        paperTrialStartedAt: paperTrialStarted
          ? (settings.paperTrialStartedAt ?? new Date().toISOString())
          : null,
      });
    } catch (caught) {
      onValidationError(
        caught instanceof Error ? caught.message : "Review the settings form.",
      );
    }
  }

  return (
    <form
      id="owner-settings-form"
      className="page-stack"
      onSubmit={submit}
    >
      <Notice title="Use cautious inputs, not the most optimistic answer" tone="warning">
        <p>
          Loss tolerance means the decline you could withstand without needing
          the money or panic-selling. Research cannot make returns predictable
          or protect a TFSA from investment losses.
        </p>
      </Notice>

      <div className="dashboard-primary-grid">
        <Card>
          <CardHeader
            title="Investor foundation"
            description="Required context before any candidate label"
            action={
              <Badge tone={onboardingComplete ? "good" : "watch"}>
                {onboardingComplete ? "Complete" : "Needs review"}
              </Badge>
            }
          />
          <div className="form-grid">
            <label className="field">
              <span>Time horizon</span>
              <input
                name="horizonYears"
                type="number"
                min="1"
                max="50"
                step="1"
                defaultValue={settings.horizonYears}
                required
              />
              <small>Years before you reasonably expect to need this money.</small>
            </label>
            <label className="field">
              <span>Maximum tolerable loss</span>
              <input
                name="lossTolerancePct"
                type="number"
                min="1"
                max="80"
                step="1"
                defaultValue={settings.lossTolerancePct}
                required
              />
              <small>Percentage decline, not a forecast or stop-loss order.</small>
            </label>
            <label className="field">
              <span>Available cash (CAD)</span>
              <input
                name="availableCashCad"
                type="number"
                min="0"
                max="100000000"
                step="0.01"
                defaultValue={settings.availableCashCad}
                required
              />
              <small>Update after deposits, withdrawals, and actual fills.</small>
            </label>
            <div className="field">
              <span>Owner</span>
              <strong>{settings.ownerEmail}</strong>
              <small>Settings are isolated to this signed-in owner.</small>
            </div>
            <label className="checkbox-field field-span-2">
              <input
                type="checkbox"
                checked={emergencyFundConfirmed}
                onChange={(event) =>
                  setEmergencyFundConfirmed(event.target.checked)
                }
              />
              <span>
                I have emergency savings outside this trading money and do not
                need these funds for near-term bills.
              </span>
            </label>
            <label className="checkbox-field field-span-2">
              <input
                type="checkbox"
                checked={onboardingComplete}
                onChange={(event) => setOnboardingComplete(event.target.checked)}
              />
              <span>
                I reviewed this profile and understand it is a research
                guardrail, not personalized financial advice.
              </span>
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Portfolio risk limits"
            description="Conservative defaults keep single-company bets small"
          />
          <div className="form-grid">
            <label className="field">
              <span>Broad ETF core target</span>
              <input
                name="etfCoreTargetPct"
                type="number"
                min="50"
                max="100"
                step="1"
                defaultValue={settings.etfCoreTargetPct}
                required
              />
              <small>At least 50% under the server-side safety policy.</small>
            </label>
            <label className="field">
              <span>All individual stocks, maximum</span>
              <input
                name="individualStocksMaxPct"
                type="number"
                min="0"
                max="50"
                step="1"
                defaultValue={settings.individualStocksMaxPct}
                required
              />
              <small>Combined percentage of the tracked portfolio.</small>
            </label>
            <label className="field">
              <span>One stock, maximum</span>
              <input
                name="singleStockMaxPct"
                type="number"
                min="0"
                max="20"
                step="0.5"
                defaultValue={settings.singleStockMaxPct}
                required
              />
              <small>Must not exceed the total individual-stock limit.</small>
            </label>
            <label className="field field-span-2">
              <span>Permanent exclusions</span>
              <textarea
                name="exclusions"
                rows={4}
                defaultValue={settings.exclusions.join("\n")}
                placeholder={"Tobacco\nGambling\nCompany or ticker to exclude"}
              />
              <small>One item per line or comma-separated; up to 30 items.</small>
            </label>
          </div>
        </Card>
      </div>

      <div className="dashboard-primary-grid">
        <Card>
          <CardHeader
            title="Research watchlist"
            description={
              providerMode === "trial"
                ? "Trial scheduled research covers four unique symbols, with holdings first"
                : "Full mode supports up to 25 owner-selected symbols"
            }
            action={
              <Badge tone={providerMode === "trial" ? "watch" : "info"}>
                {providerMode === "trial" ? "Maximum 4" : "Maximum 25"}
              </Badge>
            }
          />
          <label className="field">
            <span>Symbols</span>
            <textarea
              name="watchlist"
              rows={6}
              defaultValue={settings.watchlist.join("\n")}
              placeholder={"XGRO.TO\nVCN.TO\nVUN.TO"}
            />
            <small>
              Use provider-compatible symbols. In trial mode, current holdings
              use the four scheduled-research slots first; watchlist symbols use
              any remaining slots. A watchlist entry is not a buy recommendation.
            </small>
          </label>
          <Notice title="Safety universe remains enforced" tone="quiet" icon="shield">
            <p>
              Only liquid large-cap TSX, NYSE, or Nasdaq stocks and broad,
              non-leveraged ETFs qualify. OTC, options, crypto, penny stocks,
              microcaps, leveraged or inverse funds, shorting, and day-trading
              suggestions remain excluded.
            </p>
          </Notice>
        </Card>

        <Card>
          <CardHeader
            title="TFSA and currency"
            description="Owner-maintained estimates; no CRA or Wealthsimple sync"
          />
          <div className="form-grid">
            <label className="field">
              <span>Estimated TFSA room (CAD)</span>
              <input
                name="tfsaRoomEstimateCad"
                type="number"
                min="0"
                max="5000000"
                step="0.01"
                defaultValue={settings.tfsaRoomEstimateCad}
                required
              />
              <small>Confirm against CRA records before contributing.</small>
            </label>
            <div className="field">
              <span>Seeded 2026 annual limit</span>
              <strong>{money(settings.tfsaAnnualLimitCad)}</strong>
              <small>This is reference data, not your personal room.</small>
            </div>
            <label className="checkbox-field field-span-2">
              <input
                type="checkbox"
                checked={usdAccountEnabled}
                onChange={(event) => setUsdAccountEnabled(event.target.checked)}
              />
              <span>
                My Wealthsimple account supports USD balances. I will still
                record the actual trade-time CAD/USD rate and conversion costs.
              </span>
            </label>
          </div>
          <Notice title="TFSA losses do not create new contribution room" tone="warning">
            <p>
              Withdrawals generally return as room in the next calendar year.
              Excess contributions can attract tax. This app does not calculate
              an authoritative contribution limit.
            </p>
          </Notice>
        </Card>
      </div>

      <div className="dashboard-primary-grid">
        <Card>
          <CardHeader
            title="Market-data provider"
            description="Credentials belong in hosted secrets, never this form"
          />
          <div className="form-grid">
            <label className="field field-span-2">
              <span>Mode</span>
              <select
                value={providerMode}
                onChange={(event) => {
                  const next = event.target.value as ProviderMode;
                  setProviderMode(next);
                  if (next === "trial") {
                    setQuoteEntitlementVerified(false);
                  }
                }}
              >
                <option value="trial">
                  Alpha Vantage trial — research only, up to 4 scheduled symbols
                </option>
                <option value="full">
                  FMP full — paid plan required
                </option>
              </select>
            </label>
            <label className="checkbox-field field-span-2">
              <input
                type="checkbox"
                checked={quoteEntitlementVerified}
                disabled={providerMode !== "full"}
                onChange={(event) =>
                  setQuoteEntitlementVerified(event.target.checked)
                }
              />
              <span>
                I verified the paid provider&apos;s Canadian quote entitlement,
                timestamp freshness, and permitted personal-dashboard use.
              </span>
            </label>
          </div>
          {providerMode === "trial" ? (
            <Notice title="Trial mode cannot receive live labels" tone="warning" icon="clock">
              <p>
                Treat Alpha Vantage trial quotes as end-of-day research. Verify
                any current price in Wealthsimple before making a manual choice.
                Scheduled Calgary checks refresh provider data; manual reruns
                review saved cache without spending that request allowance.
              </p>
            </Notice>
          ) : (
            <Notice title="“Full” does not prove real-time TSX coverage" tone="warning">
              <p>
                Keep live labels locked until the quote entitlement is confirmed
                and timestamp checks pass.
              </p>
            </Notice>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Reconciliation and acknowledgements"
            description="Every item can lock live-data labels"
          />
          <div className="checklist">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={ledgerReconciled}
                onChange={(event) => setLedgerReconciled(event.target.checked)}
              />
              <span>
                I compared the current saved ledger with Wealthsimple after its
                most recent change.
                {settings.ledgerReconciledAt
                  ? ` Last recorded ${dateTime(settings.ledgerReconciledAt)}.`
                  : ""}
              </span>
            </label>
            <p className="micro-meta">
              Adding, editing, deleting, or importing a ledger row clears this
              acknowledgement automatically.
            </p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={paperTrialStarted}
                onChange={(event) => setPaperTrialStarted(event.target.checked)}
              />
              <span>
                Start or continue the paper trial.
                {settings.paperTrialStartedAt
                  ? ` Started ${dateTime(settings.paperTrialStartedAt)}.`
                  : " This records the start only when these settings are saved; running research by itself does not start the trial."}
              </span>
            </label>
            <p className="micro-meta">
              Starting the trial requires completed onboarding and a ledger
              reconciliation acknowledgement. Only scheduled morning and evening
              research runs count toward its reliability gate.
            </p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={liveLabelsAcknowledged}
                onChange={(event) =>
                  setLiveLabelsAcknowledged(event.target.checked)
                }
              />
              <span>
                I understand that “Consider candidate” and “Exit candidate” are
                research labels, not instructions or guarantees; I must review
                the evidence and place any order manually in Wealthsimple.
              </span>
            </label>
          </div>
          <p className="micro-meta">
            Last settings update: {dateTime(settings.updatedAt)}
          </p>
        </Card>
      </div>

      <div className="form-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={saving}
        >
          <Icon name={saving ? "refresh" : "check"} width={17} height={17} />
          {saving ? "Saving…" : "Save all settings"}
        </button>
        <span>
          Saving a profile never sends an order or changes Wealthsimple.
        </span>
      </div>
    </form>
  );
}

function requiredNumber(form: FormData, key: string): number {
  const value = Number(form.get(key));
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a valid number.`);
  }
  return value;
}

function normalizedList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizedSymbols(value: string): string[] {
  const symbols = normalizedList(value).map((item) => item.toUpperCase());
  const invalid = symbols.find(
    (symbol) => !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(symbol),
  );
  if (invalid) {
    throw new Error(`“${invalid}” is not a valid provider symbol.`);
  }
  return symbols;
}
