"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Icon } from "@/app/components/icons";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import { apiRequest, dateTime, money, useApi } from "@/app/lib/client";
import type {
  ImportIssue,
  ReconciliationSummary,
  WealthsimpleImportResult,
} from "@/lib/import";

type ImportPreview = {
  mode: "preview" | "commit";
  result: WealthsimpleImportResult;
  serverIssues: ImportIssue[];
  importableRows?: number;
  insertedRows?: number;
  duplicateRows?: number;
  originalFileRetained: false;
};

type BatchPayload = {
  batches: Array<{
    id: string;
    kind: string;
    fileName: string;
    importedRows: number;
    rejectedRows: number;
    duplicateRows: number;
    createdAt: string;
    reconciliation: Record<string, unknown>;
  }>;
};

export function ImportScreen() {
  const batches = useApi<BatchPayload>("/api/imports");
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"auto" | "holdings" | "activities">("auto");
  const [defaultDate, setDefaultDate] = useState(today());
  const [defaultFxRate, setDefaultFxRate] = useState("1.35");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [reconciled, setReconciled] = useState(false);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setMessage(null);
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setMessage("Choose a Wealthsimple CSV first.");
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const payload = await upload("preview");
      setPreview(payload);
      setMessage(
        payload.result.errors.length || payload.serverIssues.some((issue) => issue.severity === "error")
          ? "Preview complete. Some rows need attention before import."
          : "Preview complete. Review the reconciliation before committing.",
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Preview failed.");
    } finally {
      setWorking(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setWorking(true);
    setMessage(null);
    try {
      const payload = await upload("commit");
      setPreview(payload);
      if (reconciled) {
        await apiRequest("/api/settings", {
          method: "PATCH",
          body: JSON.stringify({ ledgerReconciledAt: new Date().toISOString() }),
        });
      }
      setMessage(
        `${payload.insertedRows ?? 0} rows imported. The original CSV was discarded.`,
      );
      await batches.reload();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setWorking(false);
    }
  }

  async function upload(mode: "preview" | "commit") {
    const form = new FormData();
    form.append("file", file!);
    form.append("mode", mode);
    form.append("kind", kind);
    form.append("defaultDate", defaultDate);
    form.append("defaultExchange", "TSX");
    form.append("defaultFxRate", defaultFxRate);
    if (mode === "commit") {
      form.append("confirm", "IMPORT_REVIEWED");
      form.append("allowPartial", String(allowPartial));
    }
    return apiRequest<ImportPreview>("/api/imports", {
      method: "POST",
      body: form,
    });
  }

  const issues = preview
    ? [...preview.result.errors, ...preview.result.warnings, ...preview.serverIssues]
    : [];
  const blocking = issues.filter((issue) => issue.severity === "error");

  return (
    <>
      <PageHeader
        eyebrow="Wealthsimple-compatible, credential-free"
        title="Import & reconcile"
        description="Preview an official holdings or activity CSV in memory. Cedar saves only normalized ledger rows and reconciliation metadata—never the original file."
      />

      {message ? (
        <Notice
          title={message}
          tone={message.includes("failed") || message.includes("attention") ? "warning" : "quiet"}
          icon={message.includes("failed") ? "warning" : "check"}
        >
          <p>Nothing is sent to Wealthsimple and no brokerage credentials are used.</p>
        </Notice>
      ) : null}

      <div className="import-layout">
        <Card className="upload-card">
          <CardHeader
            title="1. Choose an official CSV"
            description="Holdings snapshots need an average cost and as-of date. Activity rows need final prices, fees, and FX rates."
          />
          <form onSubmit={submitPreview}>
            <button
              type="button"
              className={`drop-zone ${file ? "has-file" : ""}`}
              onClick={() => fileInput.current?.click()}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={chooseFile}
                hidden
              />
              <span className="drop-icon">
                <Icon name={file ? "check" : "import"} width={25} height={25} />
              </span>
              <strong>{file ? file.name : "Select Wealthsimple CSV"}</strong>
              <span>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · ready to preview`
                  : "CSV only · maximum 2 MB"}
              </span>
            </button>

            <div className="form-grid compact-form">
              <label className="field">
                <span>File type</span>
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(
                      event.target.value as "auto" | "holdings" | "activities",
                    )
                  }
                >
                  <option value="auto">Detect automatically</option>
                  <option value="holdings">Holdings snapshot</option>
                  <option value="activities">Activity history</option>
                </select>
              </label>
              <label className="field">
                <span>Default / snapshot date</span>
                <input
                  type="date"
                  value={defaultDate}
                  onChange={(event) => setDefaultDate(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Fallback CAD per USD</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.000001"
                  value={defaultFxRate}
                  onChange={(event) => setDefaultFxRate(event.target.value)}
                  required
                />
                <small>Used only when a USD row has no FX rate.</small>
              </label>
              <label className="field">
                <span>Date order</span>
                <select disabled>
                  <option>Month / day / year</option>
                </select>
                <small>ISO dates are detected automatically.</small>
              </label>
            </div>

            <button
              className="button button-primary button-block"
              disabled={!file || working}
            >
              <Icon name="document" width={17} height={17} />
              {working ? "Reading in memory…" : "Preview reconciliation"}
            </button>
          </form>
          <div className="privacy-row">
            <Icon name="shield" width={17} height={17} />
            <span>
              The file bytes are parsed in memory and discarded after this request.
            </span>
          </div>
        </Card>

        <Card className="import-guide-card">
          <CardHeader title="Before you import" />
          <ol className="numbered-guide">
            <li>
              <span>1</span>
              <div>
                <strong>Export from Wealthsimple</strong>
                <p>Use an official custom statement or activity CSV.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Preview every row</strong>
                <p>Duplicates are idempotent; conflicts fail closed.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Compare totals</strong>
                <p>Check shares, book value, cash, fees, and currencies.</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Confirm reconciliation</strong>
                <p>Only then mark the ledger as reconciled.</p>
              </div>
            </li>
          </ol>
          <a
            className="inline-link"
            href="https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement"
            target="_blank"
            rel="noreferrer"
          >
            Wealthsimple export help{" "}
            <Icon name="external" width={14} height={14} />
          </a>
        </Card>
      </div>

      {preview ? (
        <div className="page-stack">
          <Card>
            <CardHeader
              title="2. Reconciliation preview"
              description={`Detected ${preview.result.kind ?? "unknown"} format · original retained: no`}
              action={
                <Badge tone={blocking.length ? "watch" : "good"}>
                  {blocking.length ? `${blocking.length} blocking` : "Ready to import"}
                </Badge>
              }
            />
            <Reconciliation summary={preview.result.reconciliation} />

            {issues.length ? (
              <div className="issue-list">
                {issues.slice(0, 30).map((issue, index) => (
                  <div
                    className={`issue-row issue-${issue.severity}`}
                    key={`${issue.rowNumber}-${issue.code}-${index}`}
                  >
                    <Icon
                      name={issue.severity === "error" ? "warning" : "clock"}
                      width={16}
                      height={16}
                    />
                    <div>
                      <strong>
                        Row {issue.rowNumber} · {issue.code.replaceAll("_", " ")}
                      </strong>
                      <span>{issue.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Notice title="No row-level issues found" tone="quiet" icon="check">
                <p>Still compare the totals below against Wealthsimple.</p>
              </Notice>
            )}

            <div className="commit-panel">
              {blocking.length ? (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={allowPartial}
                    onChange={(event) => setAllowPartial(event.target.checked)}
                  />
                  <span>
                    Import valid rows only. I understand blocked rows will not be
                    added.
                  </span>
                </label>
              ) : null}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={reconciled}
                  onChange={(event) => setReconciled(event.target.checked)}
                />
                <span>
                  I compared the preview with Wealthsimple and want to mark the
                  ledger reconciled.
                </span>
              </label>
              <button
                className="button button-primary"
                type="button"
                onClick={commit}
                disabled={working || (blocking.length > 0 && !allowPartial)}
              >
                <Icon name="check" width={17} height={17} />
                {working ? "Importing…" : "Confirm normalized import"}
              </button>
            </div>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Import history"
          description="Only normalized counts and reconciliation metadata are stored"
        />
        {batches.loading ? (
          <LoadingBlock rows={3} />
        ) : batches.error ? (
          <ErrorState message={batches.error} onRetry={batches.reload} />
        ) : batches.data?.batches.length ? (
          <div className="batch-list">
            {batches.data.batches.map((batch) => (
              <div className="batch-row" key={batch.id}>
                <span className="batch-icon">
                  <Icon name="document" width={18} height={18} />
                </span>
                <div>
                  <strong>{batch.fileName}</strong>
                  <span>
                    {batch.kind} · {dateTime(batch.createdAt)}
                  </span>
                </div>
                <div className="batch-counts">
                  <span>{batch.importedRows} imported</span>
                  <span>{batch.duplicateRows} duplicate</span>
                  <span>{batch.rejectedRows} blocked</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="import"
            title="No imports yet"
            description="Your first preview will appear here only after you confirm the normalized rows."
          />
        )}
      </Card>
    </>
  );
}

function Reconciliation({
  summary,
}: {
  summary: ReconciliationSummary | undefined;
}) {
  if (!summary) {
    return (
      <Notice title="No reconciliation summary available" tone="warning">
        <p>The CSV format was not recognized well enough to total.</p>
      </Notice>
    );
  }
  const counts = summary.counts;
  return (
    <div className="reconciliation-grid">
      <div>
        <span>Input rows</span>
        <strong>{counts.inputRows}</strong>
      </div>
      <div>
        <span>Accepted</span>
        <strong>{counts.acceptedRows}</strong>
      </div>
      <div>
        <span>Duplicates</span>
        <strong>{counts.duplicateRows}</strong>
      </div>
      <div>
        <span>Blocked</span>
        <strong>{counts.rejectedRows + counts.conflictRows}</strong>
      </div>
      {summary.holdings ? (
        <>
          <div>
            <span>CAD book value</span>
            <strong>{money(summary.holdings.bookValueByCurrency.CAD)}</strong>
          </div>
          <div>
            <span>USD book value</span>
            <strong>{money(summary.holdings.bookValueByCurrency.USD, "USD")}</strong>
          </div>
        </>
      ) : null}
      {summary.activities ? (
        <>
          <div>
            <span>Buys / sells</span>
            <strong>
              {summary.activities.buys} / {summary.activities.sells}
            </strong>
          </div>
          <div>
            <span>CAD fees</span>
            <strong>{money(summary.activities.feesByCurrency.CAD)}</strong>
          </div>
        </>
      ) : null}
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
