CREATE TABLE `provider_request_budgets` (
	`provider` text NOT NULL,
	`credential_fingerprint` text NOT NULL,
	`quota_date` text NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`scheduled_start_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`provider`, `credential_fingerprint`, `quota_date`)
);
