/**
 * Runtime-safe, idempotent D1 initialization.
 *
 * Sites applies the checked-in Drizzle migrations for production. These
 * statements also make local previews and newly provisioned databases usable
 * immediately. Every array item is exactly one prepared SQL statement.
 */
export const runtimeSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS owner_settings (
    owner_email TEXT PRIMARY KEY NOT NULL,
    onboarding_complete INTEGER NOT NULL DEFAULT 0,
    horizon_years INTEGER NOT NULL DEFAULT 5,
    loss_tolerance_pct REAL NOT NULL DEFAULT 20,
    emergency_fund_confirmed INTEGER NOT NULL DEFAULT 0,
    usd_account_enabled INTEGER NOT NULL DEFAULT 0,
    tfsa_room_estimate_cad REAL NOT NULL DEFAULT 7000,
    tfsa_annual_limit_cad REAL NOT NULL DEFAULT 7000,
    available_cash_cad REAL NOT NULL DEFAULT 0,
    exclusions_json TEXT NOT NULL DEFAULT '[]',
    watchlist_json TEXT NOT NULL DEFAULT '["XGRO.TO","VCN.TO","VUN.TO"]',
    etf_core_target_pct REAL NOT NULL DEFAULT 90,
    individual_stocks_max_pct REAL NOT NULL DEFAULT 10,
    single_stock_max_pct REAL NOT NULL DEFAULT 3,
    provider_mode TEXT NOT NULL DEFAULT 'trial',
    quote_entitlement_verified INTEGER NOT NULL DEFAULT 0,
    live_labels_acknowledged INTEGER NOT NULL DEFAULT 0,
    ledger_reconciled_at TEXT,
    paper_trial_started_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    action TEXT NOT NULL,
    canonical_symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    fx_rate_to_cad REAL NOT NULL DEFAULT 1,
    occurred_at TEXT NOT NULL,
    import_id TEXT,
    import_row_hash TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS transactions_owner_import_unique
    ON transactions (owner_email, import_id)`,
  `CREATE INDEX IF NOT EXISTS transactions_owner_occurred_idx
    ON transactions (owner_email, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS transactions_symbol_idx
    ON transactions (canonical_symbol)`,
  `CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    reconciliation_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS import_batches_owner_fingerprint_unique
    ON import_batches (owner_email, fingerprint)`,
  `CREATE INDEX IF NOT EXISTS import_batches_owner_created_idx
    ON import_batches (owner_email, created_at)`,
  `CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    slot TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    actual_time TEXT NOT NULL,
    status TEXT NOT NULL,
    data_freshness TEXT NOT NULL DEFAULT 'unknown',
    provider_version TEXT NOT NULL,
    model_version TEXT NOT NULL,
    market_state_json TEXT NOT NULL DEFAULT '{}',
    report_json TEXT NOT NULL DEFAULT '{}',
    errors_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS research_runs_owner_idempotency_unique
    ON research_runs (owner_email, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS research_runs_owner_actual_idx
    ON research_runs (owner_email, actual_time)`,
  `CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_symbol TEXT NOT NULL,
    source_url TEXT NOT NULL,
    category TEXT NOT NULL,
    publication_time TEXT,
    market_data_time TEXT,
    extracted_facts_json TEXT NOT NULL DEFAULT '[]',
    sentiment REAL,
    freshness TEXT NOT NULL,
    provider TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS evidence_run_idx ON evidence (run_id)`,
  `CREATE INDEX IF NOT EXISTS evidence_symbol_time_idx
    ON evidence (canonical_symbol, market_data_time)`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    score REAL,
    confidence TEXT NOT NULL,
    valuation_low REAL,
    valuation_high REAL,
    valuation_currency TEXT,
    thesis TEXT NOT NULL,
    contrary_evidence_json TEXT NOT NULL DEFAULT '[]',
    catalysts_json TEXT NOT NULL DEFAULT '[]',
    risks_json TEXT NOT NULL DEFAULT '[]',
    portfolio_impact TEXT NOT NULL,
    allocation_cap_pct REAL NOT NULL DEFAULT 0,
    invalidation_conditions_json TEXT NOT NULL DEFAULT '[]',
    evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    quote_delay_minutes INTEGER,
    data_as_of TEXT,
    research_only INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS recommendations_run_idx
    ON recommendations (run_id)`,
  `CREATE INDEX IF NOT EXISTS recommendations_symbol_idx
    ON recommendations (canonical_symbol)`,
  `CREATE TABLE IF NOT EXISTS provider_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    market_data_time TEXT,
    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    recommendation_id TEXT REFERENCES recommendations(id) ON DELETE SET NULL,
    canonical_symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    decision_price REAL NOT NULL,
    decision_currency TEXT NOT NULL,
    fx_rate_to_cad REAL NOT NULL,
    decision_time TEXT NOT NULL,
    hypothetical_fill_time TEXT,
    hypothetical_fill_price REAL,
    fees_cad REAL NOT NULL DEFAULT 0,
    benchmark_symbol TEXT NOT NULL DEFAULT 'XGRO.TO',
    benchmark_price REAL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS paper_trades_owner_time_idx
    ON paper_trades (owner_email, decision_time)`,
  `CREATE TABLE IF NOT EXISTS paper_marks (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    paper_trade_id TEXT NOT NULL REFERENCES paper_trades(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    price REAL NOT NULL,
    fx_rate_to_cad REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS paper_marks_trade_time_unique
    ON paper_marks (paper_trade_id, observed_at)`,
  `CREATE INDEX IF NOT EXISTS paper_marks_owner_time_idx
    ON paper_marks (owner_email, observed_at)`,
  `CREATE TABLE IF NOT EXISTS paper_benchmark_marks (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    canonical_symbol TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    price REAL NOT NULL,
    fx_rate_to_cad REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS paper_benchmark_owner_symbol_time_unique
    ON paper_benchmark_marks (owner_email, canonical_symbol, observed_at)`,
  `CREATE INDEX IF NOT EXISTS paper_benchmark_owner_time_idx
    ON paper_benchmark_marks (owner_email, observed_at)`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_message_id TEXT,
    error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notification_run_channel_unique
    ON notification_deliveries (run_id, channel, destination_hash)`,
] as const;
