CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`run_id` text NOT NULL,
	`canonical_symbol` text NOT NULL,
	`source_url` text NOT NULL,
	`category` text NOT NULL,
	`publication_time` text,
	`market_data_time` text,
	`extracted_facts_json` text DEFAULT '[]' NOT NULL,
	`sentiment` real,
	`freshness` text NOT NULL,
	`provider` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_run_idx` ON `evidence` (`run_id`);--> statement-breakpoint
CREATE INDEX `evidence_symbol_time_idx` ON `evidence` (`canonical_symbol`,`market_data_time`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`rejected_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`reconciliation_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_owner_fingerprint_unique` ON `import_batches` (`owner_email`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `import_batches_owner_created_idx` ON `import_batches` (`owner_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`run_id` text NOT NULL,
	`channel` text NOT NULL,
	`destination_hash` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_run_channel_unique` ON `notification_deliveries` (`run_id`,`channel`,`destination_hash`);--> statement-breakpoint
CREATE TABLE `owner_settings` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`horizon_years` integer DEFAULT 5 NOT NULL,
	`loss_tolerance_pct` real DEFAULT 20 NOT NULL,
	`emergency_fund_confirmed` integer DEFAULT false NOT NULL,
	`usd_account_enabled` integer DEFAULT false NOT NULL,
	`tfsa_room_estimate_cad` real DEFAULT 7000 NOT NULL,
	`tfsa_annual_limit_cad` real DEFAULT 7000 NOT NULL,
	`available_cash_cad` real DEFAULT 0 NOT NULL,
	`exclusions_json` text DEFAULT '[]' NOT NULL,
	`watchlist_json` text DEFAULT '["XGRO.TO","VCN.TO","VUN.TO"]' NOT NULL,
	`etf_core_target_pct` real DEFAULT 90 NOT NULL,
	`individual_stocks_max_pct` real DEFAULT 10 NOT NULL,
	`single_stock_max_pct` real DEFAULT 3 NOT NULL,
	`provider_mode` text DEFAULT 'trial' NOT NULL,
	`quote_entitlement_verified` integer DEFAULT false NOT NULL,
	`live_labels_acknowledged` integer DEFAULT false NOT NULL,
	`ledger_reconciled_at` text,
	`paper_trial_started_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_benchmark_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`canonical_symbol` text NOT NULL,
	`observed_at` text NOT NULL,
	`price` real NOT NULL,
	`fx_rate_to_cad` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_benchmark_owner_symbol_time_unique` ON `paper_benchmark_marks` (`owner_email`,`canonical_symbol`,`observed_at`);--> statement-breakpoint
CREATE INDEX `paper_benchmark_owner_time_idx` ON `paper_benchmark_marks` (`owner_email`,`observed_at`);--> statement-breakpoint
CREATE TABLE `paper_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`paper_trade_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`price` real NOT NULL,
	`fx_rate_to_cad` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`paper_trade_id`) REFERENCES `paper_trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_marks_trade_time_unique` ON `paper_marks` (`paper_trade_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `paper_marks_owner_time_idx` ON `paper_marks` (`owner_email`,`observed_at`);--> statement-breakpoint
CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`recommendation_id` text,
	`canonical_symbol` text NOT NULL,
	`action` text NOT NULL,
	`quantity` real NOT NULL,
	`decision_price` real NOT NULL,
	`decision_currency` text NOT NULL,
	`fx_rate_to_cad` real NOT NULL,
	`decision_time` text NOT NULL,
	`hypothetical_fill_time` text,
	`hypothetical_fill_price` real,
	`fees_cad` real DEFAULT 0 NOT NULL,
	`benchmark_symbol` text DEFAULT 'XGRO.TO' NOT NULL,
	`benchmark_price` real,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `recommendations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `paper_trades_owner_time_idx` ON `paper_trades` (`owner_email`,`decision_time`);--> statement-breakpoint
CREATE TABLE `provider_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`payload_json` text NOT NULL,
	`market_data_time` text,
	`cached_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`run_id` text NOT NULL,
	`canonical_symbol` text NOT NULL,
	`action` text NOT NULL,
	`score` real,
	`confidence` text NOT NULL,
	`valuation_low` real,
	`valuation_high` real,
	`valuation_currency` text,
	`thesis` text NOT NULL,
	`contrary_evidence_json` text DEFAULT '[]' NOT NULL,
	`catalysts_json` text DEFAULT '[]' NOT NULL,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`portfolio_impact` text NOT NULL,
	`allocation_cap_pct` real DEFAULT 0 NOT NULL,
	`invalidation_conditions_json` text DEFAULT '[]' NOT NULL,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`quote_delay_minutes` integer,
	`data_as_of` text,
	`research_only` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recommendations_run_idx` ON `recommendations` (`run_id`);--> statement-breakpoint
CREATE INDEX `recommendations_symbol_idx` ON `recommendations` (`canonical_symbol`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`slot` text NOT NULL,
	`scheduled_time` text NOT NULL,
	`actual_time` text NOT NULL,
	`status` text NOT NULL,
	`data_freshness` text DEFAULT 'unknown' NOT NULL,
	`provider_version` text NOT NULL,
	`model_version` text NOT NULL,
	`market_state_json` text DEFAULT '{}' NOT NULL,
	`report_json` text DEFAULT '{}' NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_runs_owner_idempotency_unique` ON `research_runs` (`owner_email`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `research_runs_owner_actual_idx` ON `research_runs` (`owner_email`,`actual_time`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`action` text NOT NULL,
	`canonical_symbol` text NOT NULL,
	`exchange` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`fx_rate_to_cad` real DEFAULT 1 NOT NULL,
	`occurred_at` text NOT NULL,
	`import_id` text,
	`import_row_hash` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_owner_import_unique` ON `transactions` (`owner_email`,`import_id`);--> statement-breakpoint
CREATE INDEX `transactions_owner_occurred_idx` ON `transactions` (`owner_email`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_symbol_idx` ON `transactions` (`canonical_symbol`);