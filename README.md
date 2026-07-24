# Cedar TFSA Research Desk

Cedar is a private, evidence-backed research assistant for a Canadian
Wealthsimple TFSA. It keeps a CAD-based portfolio ledger, reviews configured
stocks and ETFs, and produces cautious research labels such as **Watch**,
**Hold**, **Review**, **Consider candidate**, or **Exit candidate**.

It is not a brokerage, financial adviser, or profit guarantee. Cedar never logs
in to Wealthsimple and never places an order. You review the evidence, confirm
the current quote in Wealthsimple, and make every trade yourself.

## How the agent works

1. You enter transactions manually or preview and import a Wealthsimple
   holdings/activity CSV.
2. Cedar stores normalized ledger entries in its private D1 database and
   calculates positions, average cost, realized results, cash flow, and an
   estimated TFSA contribution-room balance.
3. A cloud schedule calls Cedar at **7:30 AM** and **5:30 PM**, Monday through
   Friday, in `America/Edmonton` (Calgary time).
4. Cedar gathers market data, company facts, valuation inputs, analyst data,
   news, and sentiment from the configured provider. Deterministic scoring and
   safety gates produce the research label; OpenAI can optionally explain only
   the saved, source-linked evidence.
5. You read the report, its data timestamp, contrary evidence, risks, and
   portfolio impact before deciding whether to do anything in Wealthsimple.

Scheduled runs are de-duplicated by Calgary date and morning/evening slot.
Manual runs remain available from the app and from the GitHub Actions
`workflow_dispatch` control.

### Does the computer need to stay on?

No, not with the recommended setup. OpenAI Sites hosts the private app and
GitHub Actions triggers the two research runs in the cloud. Your computer and
browser can be closed.

If you run only `npm run dev` on your own computer, the app exists only while
that process and computer are running. Local-only operation is useful for
testing, but it is not a dependable daily scheduler.

## What Cedar does—and does not do

Cedar includes:

- a private, single-owner dashboard protected by Sign in with ChatGPT;
- a CAD-normalized TFSA ledger for CAD and USD transactions;
- manual transaction entry and preview-first Wealthsimple CSV import;
- duplicate-resistant imports without retaining the original CSV;
- a configurable watchlist, portfolio limits, and exclusions;
- source-linked market, fundamentals, valuation, news, and sentiment research;
- freshness, evidence-quality, portfolio-risk, and operational-readiness gates;
- a paper-trade trial and optional email summaries; and
- twice-weekday Calgary-time research automation.

Cedar deliberately does not:

- ask for or store Wealthsimple credentials;
- scrape Wealthsimple or use an unofficial trading API;
- submit, cancel, or modify orders;
- turn social sentiment alone into a trade;
- hide missing, stale, conflicting, or rate-limited data; or
- promise that a recommendation will make money.

## Local setup

### Prerequisites

- Node.js `22.13.0` or newer
- npm
- At least one market-data API key:
  - Alpha Vantage for `trial` provider mode, or
  - Financial Modeling Prep for `full` provider mode
- Optional: an OpenAI API key for evidence explanations
- Optional: Resend credentials for email notifications

### Start the app

From PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

On macOS or Linux, use `cp .env.example .env.local` instead of `Copy-Item`.
Open the local URL printed in the terminal. Development mode supplies a local
demo owner; do not enable that bypass in production.

The local D1 database is created automatically through the Cloudflare
development runtime. Local database state and tool logs live under
`.wrangler/`, which is ignored by Git.

## Environment variables

Copy `.env.example` to `.env.local` for local development. For the deployed
site, configure the same values as Sites runtime environment variables; a
local `.env.local` file is not deployed.

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `OWNER_EMAIL` | Required in production | Exact email allowed to own the private ledger and scheduled runs |
| `SCHEDULER_SECRET` | Required for automation | Long random bearer secret accepted by `/api/scheduled/run` |
| `ALPHA_VANTAGE_API_KEY` | Required in `trial` mode | Trial quotes, company overview, news, and sentiment |
| `FMP_API_KEY` | Required in `full` mode | Full quotes, company facts, ratios, estimates, and news |
| `NEXT_PUBLIC_SITE_URL` | Recommended in production | Deployed `https://…` origin used in metadata and email links |
| `OPENAI_API_KEY` | Optional | Explains saved evidence; deterministic fallback is used without it |
| `RESEND_API_KEY` | Optional | Sends completion email summaries |
| `NOTIFICATION_EMAIL` | Required for email | Address that receives the summary |
| `RESEND_FROM_EMAIL` | Optional | Verified Resend sender; otherwise the Resend onboarding sender is used |
| `ALLOW_LOCAL_DEMO` | Local only | Keep `false` in production; development already enables the local owner |

Generate a separate scheduler secret instead of reusing an API key:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that exact value in the deployed Sites environment and in the GitHub
Actions secret named `SCHEDULER_SECRET`. Never commit it.

## First-time use

1. Open **Settings**. Record your real investing horizon, loss tolerance,
   emergency-fund status, available cash, USD-account status, watchlist, and
   position limits.
2. Enter a conservative TFSA room estimate based on your own records and CRA
   information. Cedar's figure is a ledger estimate, not an official CRA
   balance.
3. Open **Import** to upload a Wealthsimple custom holdings or activities CSV,
   or enter each transaction in **Portfolio**.
4. Always preview the reconciliation. Supply an as-of date and CAD-per-USD FX
   rate where required, correct rejected rows, and only then confirm the
   import.
5. Reconcile Cedar against Wealthsimple before relying on portfolio totals.
6. Configure the matching provider mode and API key, then run research
   manually once. Confirm that sources, timestamps, and warnings make sense.
7. Use the paper-trade trial before treating live candidate labels as useful
   decision support.

Wealthsimple documents how to request holdings and activities CSV files in its
[custom statement guide](https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement).

## Cloud deployment and daily schedule

The repository already identifies its Sites project and D1 binding in
`.openai/hosting.json`. Deploy it as a **private** OpenAI Site, then configure
the production environment variables above.

The workflow at `.github/workflows/research-schedule.yml` runs:

- `07:30`, Monday–Friday, `America/Edmonton` → morning brief
- `17:30`, Monday–Friday, `America/Edmonton` → evening review
- on demand from the GitHub Actions page → selected morning or evening slot

GitHub's IANA-time-zone schedule follows Calgary daylight-saving changes.
Scheduled workflows run from the repository's default branch and may start a
little late during GitHub Actions congestion. The weekday cron may also run on
an exchange holiday; Cedar's freshness and evidence gates still apply.

### Configure GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions**.

Create this repository variable:

| Variable | Value |
| --- | --- |
| `CEDAR_SITE_URL` | The deployed Sites origin, for example `https://your-private-site.sites.openai.com` |

Create these repository secrets:

| Secret | Value |
| --- | --- |
| `SCHEDULER_SECRET` | The same raw random value configured as the deployed Sites `SCHEDULER_SECRET` |
| `SITES_BYPASS_TOKEN` | The raw Sign in with ChatGPT bypass bearer token generated for this Sites project |

Store only the raw token values—do not include the word `Bearer`. The workflow
adds the two independent authorization headers:

- `Authorization` protects Cedar's machine-only endpoint.
- `OAI-Sites-Authorization` lets this identity-less GitHub job pass the private
  Site's Sign in with ChatGPT gate.

Ask Codex to generate the Site's Sign in with ChatGPT bypass token, then save it
immediately as `SITES_BYPASS_TOKEN`. Generating another token rotates and
invalidates the previous one, so update GitHub after every rotation.

Enable GitHub Actions, merge the workflow into the default branch, and use
**Actions → Cedar research schedule → Run workflow** for a controlled test.
The workflow logs the slot and HTTP status, but not the private report body.

See GitHub's
[schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
for timing and default-branch behavior.

## Privacy and data handling

- Do not place CSV statements, `.env.local`, API keys, tokens, or screenshots
  with account details in Git.
- Cedar reads an uploaded CSV to normalize it, then discards the original
  content. It stores normalized transaction rows, a sanitized filename,
  duplicate fingerprints, import counts, and reconciliation issues.
- D1 stores the owner email, settings, ledger, research evidence, reports,
  paper-trade records, and notification-delivery metadata. Treat the deployed
  database as sensitive financial data.
- Market-data providers receive the symbols Cedar researches.
- When enabled, OpenAI receives the researched symbol and sanitized saved
  evidence needed for an explanation. The request uses `store: false` and a
  hashed safety identifier; it does not receive Wealthsimple credentials or
  the raw CSV.
- When enabled, Resend receives the notification address and generated email
  summary. The dashboard remains the source of truth.
- Keep original Wealthsimple statements in your own secure records. Cedar is
  not a replacement for broker or tax records.

## Money and TFSA safety

The product goal is better decision discipline, not guaranteed returns.
Research labels can be wrong because markets change, data is delayed, providers
fail, and models can misinterpret evidence. Before any order:

1. verify the live bid/ask and currency in Wealthsimple;
2. read the source links, timestamps, contrary evidence, and invalidation
   conditions;
3. check diversification, position size, cash needs, and FX cost;
4. prefer a small or paper position when uncertainty is high; and
5. make the final decision yourself or with a qualified Canadian adviser.

For a TFSA specifically:

- contribution room is shared across all your TFSAs, not just Wealthsimple;
- a withdrawal normally restores room on January 1 of the following calendar
  year, not immediately;
- over-contributions can be penalized;
- frequent or professional-style trading can create business-income tax risk;
- CAD/USD conversion can add Wealthsimple FX cost; and
- US dividends received in a TFSA are generally subject to US
  non-resident withholding tax.

Check your records and current CRA information before contributing. Useful
official references:

- [CRA: What is a TFSA?](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/what.html)
- [CRA: Before you contribute](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/before.html)
- [CRA: Withdrawing from a TFSA](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/withdraw.html)
- [Wealthsimple: CAD/USD conversions](https://help.wealthsimple.com/hc/en-ca/articles/4415548242971-Convert-funds-between-CAD-and-USD)
- [Wealthsimple: Non-resident withholding tax](https://help.wealthsimple.com/hc/en-ca/articles/360056584994-Non-resident-withholding-taxes-and-how-to-minimize-them)

If your trading pattern or TFSA room is uncertain, ask a Canadian tax
professional before acting.

## Useful commands

```powershell
npm run dev          # local development
npm run test:unit    # unit tests
npm run typecheck    # TypeScript checks
npm run lint         # lint checks
npm run build        # production build
npm test             # unit tests, build, and rendered HTML test
npm run db:generate  # generate migrations after an intentional schema change
```

## Troubleshooting

- **Scheduled request returns 401:** the GitHub `SCHEDULER_SECRET` does not
  exactly match the deployed Sites value.
- **The request receives a sign-in page or access error:** the
  `SITES_BYPASS_TOKEN` is missing, expired, for another Site, or was rotated.
- **Scheduled request returns 503:** configure `OWNER_EMAIL` in the deployed
  Site.
- **Research says Insufficient data:** confirm the selected provider mode and
  matching API key, then inspect provider warnings and rate limits.
- **No scheduled run appears:** verify Actions is enabled, the workflow is on
  the default branch, all three GitHub values exist, and the Site URL is HTTPS.
- **Email is skipped:** configure both `RESEND_API_KEY` and
  `NOTIFICATION_EMAIL`; verify the sender if using `RESEND_FROM_EMAIL`.
- **Import rows are rejected:** preview again and check dates, exchange,
  currency, and CAD-per-USD FX requirements. Never force a partial import
  without reviewing every excluded row.
