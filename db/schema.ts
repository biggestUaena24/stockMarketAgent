import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const ownerSettings = sqliteTable("owner_settings", {
  ownerEmail: text("owner_email").primaryKey(),
  onboardingComplete: integer("onboarding_complete", { mode: "boolean" })
    .notNull()
    .default(false),
  horizonYears: integer("horizon_years").notNull().default(5),
  lossTolerancePct: real("loss_tolerance_pct").notNull().default(20),
  emergencyFundConfirmed: integer("emergency_fund_confirmed", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  usdAccountEnabled: integer("usd_account_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  tfsaRoomEstimateCad: real("tfsa_room_estimate_cad").notNull().default(7000),
  tfsaAnnualLimitCad: real("tfsa_annual_limit_cad").notNull().default(7000),
  availableCashCad: real("available_cash_cad").notNull().default(0),
  exclusionsJson: text("exclusions_json").notNull().default("[]"),
  watchlistJson: text("watchlist_json")
    .notNull()
    .default('["XGRO.TO","VCN.TO","VUN.TO"]'),
  etfCoreTargetPct: real("etf_core_target_pct").notNull().default(90),
  individualStocksMaxPct: real("individual_stocks_max_pct")
    .notNull()
    .default(10),
  singleStockMaxPct: real("single_stock_max_pct").notNull().default(3),
  providerMode: text("provider_mode").notNull().default("trial"),
  quoteEntitlementVerified: integer("quote_entitlement_verified", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  liveLabelsAcknowledged: integer("live_labels_acknowledged", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  ledgerReconciledAt: text("ledger_reconciled_at"),
  paperTrialStartedAt: text("paper_trial_started_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    action: text("action").notNull(),
    canonicalSymbol: text("canonical_symbol").notNull(),
    exchange: text("exchange").notNull(),
    quantity: real("quantity").notNull(),
    price: real("price").notNull(),
    currency: text("currency").notNull(),
    fee: real("fee").notNull().default(0),
    fxRateToCad: real("fx_rate_to_cad").notNull().default(1),
    occurredAt: text("occurred_at").notNull(),
    importId: text("import_id"),
    importRowHash: text("import_row_hash"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("transactions_owner_import_unique").on(
      table.ownerEmail,
      table.importId,
    ),
    index("transactions_owner_occurred_idx").on(
      table.ownerEmail,
      table.occurredAt,
    ),
    index("transactions_symbol_idx").on(table.canonicalSymbol),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    importedRows: integer("imported_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    reconciliationJson: text("reconciliation_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_batches_owner_fingerprint_unique").on(
      table.ownerEmail,
      table.fingerprint,
    ),
    index("import_batches_owner_created_idx").on(
      table.ownerEmail,
      table.createdAt,
    ),
  ],
);

export const researchRuns = sqliteTable(
  "research_runs",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    slot: text("slot").notNull(),
    scheduledTime: text("scheduled_time").notNull(),
    actualTime: text("actual_time").notNull(),
    status: text("status").notNull(),
    dataFreshness: text("data_freshness").notNull().default("unknown"),
    providerVersion: text("provider_version").notNull(),
    modelVersion: text("model_version").notNull(),
    marketStateJson: text("market_state_json").notNull().default("{}"),
    reportJson: text("report_json").notNull().default("{}"),
    errorsJson: text("errors_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("research_runs_owner_idempotency_unique").on(
      table.ownerEmail,
      table.idempotencyKey,
    ),
    index("research_runs_owner_actual_idx").on(
      table.ownerEmail,
      table.actualTime,
    ),
  ],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    canonicalSymbol: text("canonical_symbol").notNull(),
    sourceUrl: text("source_url").notNull(),
    category: text("category").notNull(),
    publicationTime: text("publication_time"),
    marketDataTime: text("market_data_time"),
    extractedFactsJson: text("extracted_facts_json").notNull().default("[]"),
    sentiment: real("sentiment"),
    freshness: text("freshness").notNull(),
    provider: text("provider").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("evidence_run_idx").on(table.runId),
    index("evidence_symbol_time_idx").on(
      table.canonicalSymbol,
      table.marketDataTime,
    ),
  ],
);

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    canonicalSymbol: text("canonical_symbol").notNull(),
    action: text("action").notNull(),
    score: real("score"),
    confidence: text("confidence").notNull(),
    valuationLow: real("valuation_low"),
    valuationHigh: real("valuation_high"),
    valuationCurrency: text("valuation_currency"),
    thesis: text("thesis").notNull(),
    contraryEvidenceJson: text("contrary_evidence_json")
      .notNull()
      .default("[]"),
    catalystsJson: text("catalysts_json").notNull().default("[]"),
    risksJson: text("risks_json").notNull().default("[]"),
    portfolioImpact: text("portfolio_impact").notNull(),
    allocationCapPct: real("allocation_cap_pct").notNull().default(0),
    invalidationConditionsJson: text("invalidation_conditions_json")
      .notNull()
      .default("[]"),
    evidenceIdsJson: text("evidence_ids_json").notNull().default("[]"),
    quoteDelayMinutes: integer("quote_delay_minutes"),
    dataAsOf: text("data_as_of"),
    researchOnly: integer("research_only", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("recommendations_run_idx").on(table.runId),
    index("recommendations_symbol_idx").on(table.canonicalSymbol),
  ],
);

export const providerCache = sqliteTable("provider_cache", {
  cacheKey: text("cache_key").primaryKey(),
  provider: text("provider").notNull(),
  payloadJson: text("payload_json").notNull(),
  marketDataTime: text("market_data_time"),
  cachedAt: text("cached_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
});

export const providerRequestBudgets = sqliteTable(
  "provider_request_budgets",
  {
    provider: text("provider").notNull(),
    credentialFingerprint: text("credential_fingerprint").notNull(),
    quotaDate: text("quota_date").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    scheduledStartMs: integer("scheduled_start_ms").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({
      name: "provider_request_budgets_pk",
      columns: [
        table.provider,
        table.credentialFingerprint,
        table.quotaDate,
      ],
    }),
  ],
);

export const paperTrades = sqliteTable(
  "paper_trades",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    recommendationId: text("recommendation_id").references(
      () => recommendations.id,
      { onDelete: "set null" },
    ),
    canonicalSymbol: text("canonical_symbol").notNull(),
    action: text("action").notNull(),
    quantity: real("quantity").notNull(),
    decisionPrice: real("decision_price").notNull(),
    decisionCurrency: text("decision_currency").notNull(),
    fxRateToCad: real("fx_rate_to_cad").notNull(),
    decisionTime: text("decision_time").notNull(),
    hypotheticalFillTime: text("hypothetical_fill_time"),
    hypotheticalFillPrice: real("hypothetical_fill_price"),
    feesCad: real("fees_cad").notNull().default(0),
    benchmarkSymbol: text("benchmark_symbol").notNull().default("XGRO.TO"),
    benchmarkPrice: real("benchmark_price"),
    status: text("status").notNull().default("queued"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("paper_trades_owner_time_idx").on(
      table.ownerEmail,
      table.decisionTime,
    ),
  ],
);

export const paperMarks = sqliteTable(
  "paper_marks",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    paperTradeId: text("paper_trade_id")
      .notNull()
      .references(() => paperTrades.id, { onDelete: "cascade" }),
    observedAt: text("observed_at").notNull(),
    price: real("price").notNull(),
    fxRateToCad: real("fx_rate_to_cad").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("paper_marks_trade_time_unique").on(
      table.paperTradeId,
      table.observedAt,
    ),
    index("paper_marks_owner_time_idx").on(
      table.ownerEmail,
      table.observedAt,
    ),
  ],
);

export const paperBenchmarkMarks = sqliteTable(
  "paper_benchmark_marks",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    canonicalSymbol: text("canonical_symbol").notNull(),
    observedAt: text("observed_at").notNull(),
    price: real("price").notNull(),
    fxRateToCad: real("fx_rate_to_cad").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("paper_benchmark_owner_symbol_time_unique").on(
      table.ownerEmail,
      table.canonicalSymbol,
      table.observedAt,
    ),
    index("paper_benchmark_owner_time_idx").on(
      table.ownerEmail,
      table.observedAt,
    ),
  ],
);

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    destinationHash: text("destination_hash").notNull(),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("notification_run_channel_unique").on(
      table.runId,
      table.channel,
      table.destinationHash,
    ),
  ],
);
