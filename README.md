# CPR Analytics

Central Pivot Range analytics for Indian indices, commodities and crypto. Shows
the next trading day's CPR by default, the last 10 sessions, any date within a
90-day window, width in points and percent, dual classification, R1–R5 / S1–S5,
and cross-instrument comparison. Nine instruments across Indian indices,
global (USD) and Indian (INR) commodities, and crypto.

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Recharts · Drizzle ORM ·
Postgres (Supabase) · Vitest. Deploys to Vercel.

---

## Contents

1. [Quick start](#quick-start)
2. [Environment variables](#environment-variables)
3. [Market data provider](#market-data-provider)
4. [Database setup](#database-setup)
5. [Migrations](#migrations)
6. [Running locally](#running-locally)
7. [Data synchronisation](#data-synchronisation)
8. [Storage and caching](#storage-and-caching)
9. [Deploying](DEPLOYMENT.md)
9. [Vercel deployment](#vercel-deployment)
10. [Cron configuration](#cron-configuration)
11. [API reference](#api-reference)
12. [Architecture](#architecture)
13. [How CPR is calculated](#how-cpr-is-calculated)
14. [Classification](#classification)
15. [Filtering by CPR category](#filtering-by-cpr-category)
16. [Market calendar](#market-calendar)
17. [Testing](#testing)
18. [Known limitations](#known-limitations)

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional; the app boots with no config at all
npm run dev                    # http://localhost:3000
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` for the copy step.

**No configuration is needed to run the app.** With no `DATABASE_URL`, every CPR
is computed live from the market-data provider on request. The database adds
persistence, caching and history beyond the provider's window — it is not
required for correctness.

---

## Environment variables

Copy `.env.example` to `.env.local`. Nothing here is exposed to the browser: no
variable is prefixed `NEXT_PUBLIC_`, and every one is read only in server code.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Postgres connection string (Supabase **transaction pooler**, port 6543). Omit to run in live-compute mode. |
| `DIRECT_DATABASE_URL` | For migrations | Supabase **direct** string (port 5432). Used by `db:migrate` only. |
| `MARKET_DATA_PROVIDER` | No | `yahoo` (default), `upstox`, `kite`, or `mock`. |
| `UPSTOX_ACCESS_TOKEN` | For Indian data | Analytics Token — free, valid 1 year, read-only. Set it and Indian instruments switch to Upstox automatically. |
| `KITE_API_KEY` | For `kite` | Zerodha Kite Connect API key. |
| `KITE_ACCESS_TOKEN` | For `kite` | Expires 6 AM IST daily; needs manual renewal. |
| `MARKET_DATA_API_KEY` | No | Reserved for providers that authenticate. Yahoo needs none. |
| `ALLOW_MOCK_PROVIDER_IN_PRODUCTION` | No | Escape hatch; see below. |
| `CRON_SECRET` | For cron | Protects the sync/cleanup/admin endpoints. |
| `DATA_RETENTION_DAYS` | No | Defaults to 90. |
| `SUPABASE_*` | No | Only if you use the Supabase JS client directly. |

Generate a cron secret with:

```bash
openssl rand -hex 32
```

---

## Market data provider

The app depends on the `MarketDataProvider` interface
(`lib/market-data/provider.ts`), never on a vendor. Two implementations ship:

### `yahoo` (default, real data, no API key)

`lib/market-data/providers/yahoo.ts` reads the Yahoo Finance chart endpoint.

| Instrument | Symbol | Venue | Currency |
| --- | --- | --- | --- |
| NIFTY 50 | `^NSEI` | NSE | INR |
| BANK NIFTY | `^NSEBANK` | NSE | INR |
| SENSEX | `^BSESN` | BSE | INR |
| Gold | auto-resolved `GC<month><yy>.CMX` | COMEX | USD |
| Silver | auto-resolved `SI<month><yy>.CMX` | COMEX | USD |
| Crude Oil | auto-resolved `CL<month><yy>.NYM` | NYMEX | USD |
| Bitcoin | `BTC-USD` | 24/7 | USD |

#### Scope: derivatives only

CPR here is used to trade F&O, so every instrument is a futures contract or an
index with a listed derivatives market. The MCX contracts are reachable only
through Upstox — **Yahoo has no MCX coverage**, verified against `GOLD.MCX`,
`GOLDM.MCX`, `SILVER.MCX`, `CRUDEOIL.MCX`, `MCXGOLD.NS` and `CRUDEOIL.NS`, all
404 — so on the Yahoo provider alone they report unavailable rather than being
substituted with a COMEX proxy.

MCX levels are **not** synthesised from COMEX × USDINR. That ignores import duty
(~6%), GST (3%) and local basis, so the numbers would look plausible and be
wrong. The measured gap on the pull documented below was +12.3% on gold and
+14.9% on silver.

The NSE gold and silver ETFs (`GOLDBEES.NS`, `SILVERBEES.NS`) were carried here
for a while as INR commodity stand-ins, from when Yahoo was the only provider.
They have been removed: they are cash-segment instruments with **no
derivatives** — in Upstox's NSE instrument master both appear only as
`NSE_EQ`/`EQ` rows, with zero FUT/CE/PE against either — and their levels are
ETF unit prices (~₹133) that do not transfer to an MCX contract. Now that
Upstox reaches the real contracts, the stand-ins have no purpose.

No INR crude instrument exists on NSE, so Crude Oil remains NYMEX-only.

It is an undocumented public endpoint with no SLA. For production traffic,
substitute a commercial feed — see [Swapping the provider](#swapping-the-provider).

#### Why commodities do NOT use Yahoo's `=F` aliases

**Yahoo's continuous `GC=F` / `SI=F` aliases serve defective daily bars.**
Measured over 63 real sessions against the *identical contract* fetched by its
explicit exchange symbol:

| Symbol | Contract | Zero-range bars | Median volume | **Median daily range** |
| --- | --- | --- | --- | --- |
| `SI=F` | Silver Sep 26 | **9 / 63** | 73 | **1.11** |
| `SIU26.CMX` | Silver Sep 26 — same | 0 | 32,765 | **2.65** |
| `GC=F` | Gold Dec 26 | 1 | 770 | **67.30** |
| `GCZ26.CMX` | Gold Dec 26 — same | 0 | 20,767 | **95.20** |

The alias understates the median daily range by **58 % for silver and 29 % for
gold**. CPR width is derived directly from the session high and low, so the alias
corrupts width, width % and therefore the classification. On 21 Aug 2026 `GC=F`
reported H 4624.1 / L 4560.0 (range 64.1) where the contract actually traded
H 4690.4 / L 4565.5 (range 124.9) — and the alias matched neither the front
contract *nor* the prior one, so it is not merely a roll offset.

Correcting this moved Gold from **MIXED (0.4643 %)** to **WIDER (0.7556 %)** and
Silver from **MIXED (0.4773 %)** to **WIDER (0.4914 %)**. Crude was unaffected —
`CL=F` was already healthy, and switching it to `CLV26.NYM` produced identical
figures, which is a useful control.

**Contracts are resolved automatically.** Addressing a contract explicitly
introduces expiry, so `lib/market-data/contracts.ts` generates the next four
listed months for the product and the provider queries each for recent volume,
picking the most liquid — which is what "front month" means. The series therefore
rolls itself with no maintenance, and the resolved symbol is stored on every row
(`provider_symbol`) and shown in the UI, because two contract months trade at
different prices and a figure must be traceable to the exact series it came from.

If every candidate fails the provider raises an error rather than falling back to
the `=F` alias: showing a range understated by up to 58 % is worse than showing
"temporarily unavailable".

### `upstox` (recommended for Indian instruments)

Driven by an **Analytics Token**, which is the piece that makes this practical:

| | Yahoo | Kite | **Upstox Analytics** |
| --- | --- | --- | --- |
| Token upkeep | none | **daily** manual login | **once a year** |
| Cost | free | paid add-on | **free** |
| MCX | **none — all symbols 404** | yes | **yes** |
| Instrument list | n/a | needs auth | **public, no auth** |
| Order risk if leaked | n/a | full trading scope | **read-only** |

The Analytics Token is generated from the Developer Apps dashboard (Analytics
tab) with no OAuth redirect, is valid for a year, and cannot place, modify or
cancel orders. Market-data endpoints need no static IP, so it works from
serverless. Only one token is active per account — generating a new one revokes
the previous.

#### Setup — one variable

```bash
UPSTOX_ACCESS_TOKEN=your_analytics_token
```

That is the whole migration. Instruments carry a `preferredProvider`, and the
eight Indian ones name Upstox: NIFTY 50, BANK NIFTY, SENSEX, the two NSE ETFs
and the three MCX contracts. They route to Upstox the moment the token exists
and fall back to the configured default when it does not, so removing the token
degrades rather than breaks. Global commodities and BTC stay on Yahoo.

Setting `MARKET_DATA_PROVIDER=upstox` as well would route *everything* through
Upstox, which is not wanted — it has no COMEX or crypto coverage.

Confirm the routing per instrument: every API record carries `dataSource`, and
`/api/cpr/compare` shows all twelve at once.

#### The current session lives on a different endpoint

Upstox's daily series **excludes the session in progress**. Measured at 18:30
IST, its newest daily candle was the *previous* session for every instrument
type. Today's session comes from the intraday endpoint instead
(`/v3/historical-candle/intraday/{key}/days/1`), which returns it as a single
day candle matching NSE exactly. The provider fetches both and merges them, the
daily record winning on overlap once it exists. Without that, the next day's CPR
could never be formed.

#### "No segments for these users are active"

An **account** error, not a token or code error — the token authenticated, but
the Upstox account has no active trading segments. Indian brokers deactivate
segments after a period of inactivity, and SEBI requires periodic
re-validation.

Fix it in the **Upstox app or web** (not the developer portal): reactivate the
account and enable the segments you need. MCX additionally needs the
**commodity** segment, which usually requires income proof.

Until it is sorted, `MARKET_DATA_PROVIDER=yahoo` serves every instrument except
the three MCX ones. The provider appends this guidance to the raw error so it is
readable where it appears.

#### What it unlocks

**MCX contracts in INR** — `GOLD_MCX`, `SILVER_MCX`, `CRUDEOIL_MCX`. These are
the contracts Indian commodity traders actually trade, not COMEX proxies.
Because Yahoo has no MCX coverage whatsoever, they report
`PROVIDER_LACKS_INSTRUMENT` on the default provider with a message naming what
to switch to — deliberately, since showing a COMEX proxy under an MCX name would
be worse than showing nothing.

**Contracts roll themselves.** MCX futures expire, so the provider resolves the
nearest sufficiently-distant expiry from Upstox's public instrument master,
skipping any contract within 3 days of expiry — liquidity has already moved on
by then, and thin final sessions produce erratic ranges. No expiry is hardcoded.

The instrument keys shipped for the NSE/BSE instruments (`NSE_INDEX|Nifty 50`,
`NSE_INDEX|Nifty Bank`, `BSE_INDEX|SENSEX`, `NSE_EQ|INF204KB17I5`,
`NSE_EQ|INF204KC1402`) were read from that public master rather than guessed.

### `kite` (Zerodha Kite Connect — MCX, but daily token renewal)

Exchange-sourced Indian data. Fixes the two things Yahoo structurally cannot:

**Settlement latency.** Yahoo publishes a settled daily bar hours after the
close — measured 32 minutes after the 2026-08-25 NSE close, its bar still
carried volume 0 and a close exactly equal to the high, so the next session's
CPR could not be computed. Kite serves the exchange's own candles, so a session
is final when the session is.

**MCX.** Yahoo has no MCX coverage — every MCX symbol returns 404. Kite reaches
MCX futures directly, so Gold/Silver/Crude can be the contracts Indian traders
actually trade rather than COMEX proxies in USD.

#### The catch, before you commit to it

**The access token expires at 6 AM IST every day** and can only be regenerated
through an interactive browser login. This is a regulatory requirement, not an
API limitation — no server-side code can refresh it unattended. A deployment on
`kite` therefore needs a **daily manual step**, or it goes dark each morning
until someone supplies a new token.

The provider fails loudly rather than silently when that happens: a `403`
produces "Kite access token is invalid or has expired…", and the app falls back
to its "market data temporarily unavailable" state rather than showing stale
figures.

The historical data API is also a **paid add-on** on top of the Kite Connect
subscription.

#### Setup

1. Create an app at [developers.kite.trade](https://developers.kite.trade) and
   subscribe to the **Historical Data** add-on.
2. Complete the login flow to obtain an `access_token`
   ([docs](https://kite.trade/docs/connect/v3/user/)).
3. Set the variables and switch the provider:

```bash
MARKET_DATA_PROVIDER=kite
KITE_API_KEY=your_api_key
KITE_ACCESS_TOKEN=token_from_todays_login
```

4. Verify with `/api/health` — `provider.id` should read `kite` and
   `provider.ok` be `true`.

#### Adding MCX instruments

Once Kite is working, MCX contracts are a registry entry with a `kite` symbol:

```ts
{
  symbol: "GOLD_MCX",
  name: "Gold (MCX)",
  category: "COMMODITIES_IN",
  market: "MCX",
  currency: "INR",
  providerSymbols: { kite: "MCX:GOLDM26DECFUT" },
  classificationMethod: "PERCENTAGE",
}
```

MCX futures trading symbols embed the expiry, so they roll each contract cycle.
When a symbol stops resolving the provider lists the closest live matches from
the instruments dump, which tells you the new one.

> The `kite` symbols shipped for the existing NSE/BSE instruments
> (`NSE:NIFTY 50`, `NSE:NIFTY BANK`, `BSE:SENSEX`) follow Kite's documented
> naming but have **not** been
> verified against a live instruments dump — that needs credentials. If one does
> not resolve, the error names the closest matches.

### `mock` (development only)

`lib/market-data/providers/mock.ts` generates deterministic **synthetic** prices
so the app runs offline. It is fenced off from production:

- `getMarketDataProvider()` **throws** if `MARKET_DATA_PROVIDER=mock` while
  `NODE_ENV=production`, unless `ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true`.
- The sync job **refuses to write** mock output to the database.
- Every API response carries `meta.context.isMockData`, and the UI renders an
  unmissable red banner.

### Swapping the provider

Implement three methods and register the class in `lib/market-data/index.ts`:

```ts
class MyProvider implements MarketDataProvider {
  readonly id = "myfeed";
  readonly label = "My Feed";
  readonly isMock = false;

  getHistoricalOHLC(req): Promise<SessionBar[]>      // oldest first
  getLatestOHLC(instrument): Promise<SessionBar | null>
  getTradingCalendar(req): Promise<ISODate[]>        // dates actually traded
  getResolvedSymbol(instrument): Promise<string>     // series actually queried
}
```

The one contract that matters: **`SessionBar.complete` must be `false` while a
session is still open.** Everything downstream relies on it to avoid projecting a
CPR from a half-formed candle. When completeness cannot be proven, return
`false` — a stale-but-correct CPR beats a wrong one.

Adding an **instrument** needs no provider change: add an entry to
`lib/instruments/index.ts` with its `providerSymbols` and `market`.

---

## Database setup

Optional — the app is fully functional without it. Adding one enables
persistence, cross-deployment caching, and history beyond the provider's window.

### 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a project.
2. **Settings → Database → Connection string.** You need **both**:

| String | Port | Used for | Why |
| --- | --- | --- | --- |
| **Transaction pooler** | `6543` | the app (`DATABASE_URL`) | serverless-safe; the direct string is IPv6-only and fails from Vercel and most home networks |
| **Direct** | `5432` | migrations (`DIRECT_DATABASE_URL`) | DDL over a transaction pooler is unreliable |

### 2. Add them to `.env.local`

`.env.local` is already created and git-ignored. Fill in:

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

URL-encode special characters in the password: `@` → `%40`, `#` → `%23`,
`/` → `%2F`. An un-encoded `@` is the single most common cause of an
authentication failure here.

> Paste the credentials yourself rather than sharing them — nothing in this
> project needs them anywhere except this file.

### 3. Apply migrations and verify

```bash
npm run db:migrate     # uses DIRECT_DATABASE_URL automatically
npm run db:check       # connects, checks schema + indexes, reports contents
```

`db:check` prints the host, server version, whether every index exists, and a
per-instrument row summary. It never prints the password, and it explains the
common failures (bad password, IPv6-only direct string, missing migrations, TLS).

Expected output before the first sync:

```
  ✓ Connected — PostgreSQL 15.x
  ✓ Table cpr_data exists
  ✓ All 6 indexes present
  ✓ Table is empty — 0 rows
```

### 4. Populate it

Nothing further is required — rows are written through as you browse. To
backfill immediately, set `CRON_SECRET` and run the sync:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/admin/sync `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

Then confirm the read path is live: request the same instrument twice and check
that `meta.context.fromDatabase` is `true`.

The client sets `prepare: false`, which the transaction pooler requires.

### Schema

One table, `cpr_data`. Prices are `numeric(20,4)` and width % is
`numeric(12,6)` — exact decimal, never floating point, because a CPR width is a
difference between two large nearly-equal numbers where float error is
proportionally worst.

- Unique index on `(instrument_symbol, trading_date)` — makes sync idempotent.
- Indexes on `instrument_symbol`, `trading_date DESC`, `instrument_category`,
  and a composite `(instrument_symbol, trading_date DESC)` for the hot path.

---

## Migrations

```bash
npm run db:generate    # SQL from lib/db/schema.ts -> ./drizzle
npm run db:migrate     # apply — prefers DIRECT_DATABASE_URL, falls back to DATABASE_URL
npm run db:check       # verify connection, schema and contents
npm run db:studio      # browse
```

Migrations are committed under `drizzle/`. `drizzle.config.ts` loads
`.env.local` itself (drizzle-kit does not) and prefers `DIRECT_DATABASE_URL`, so
migrations use the direct connection while the app keeps using the pooler — no
swapping variables.

---

## Running locally

```bash
npm run dev         # dev server
npm run build       # production build
npm start           # serve the build
npm test            # unit tests
npm run typecheck   # tsc --noEmit
npm run lint
```

---

## Data synchronisation

The sync pipeline (`lib/services/sync.ts`) does, per instrument:

1. Fetch the OHLC window from the provider.
2. Keep only **completed** sessions.
3. For each completed session `d[i]`, derive the CPR from `d[i-1]`.
4. Derive one forward record for the next trading day from the latest completed
   session.
5. Compute width, width %, both classifications, the overall verdict, R1–R5/S1–S5.
6. Upsert on `(instrument_symbol, trading_date)`.
7. Delete anything older than the retention window.

Idempotent — running it twice updates rather than duplicates. Instruments sync
concurrently and failures are isolated, so one dead symbol cannot stop the rest.

Trigger manually:

```bash
curl -X POST http://localhost:3000/api/admin/sync \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"instruments":["NIFTY50"],"windowDays":30}'
```

PowerShell equivalent:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/admin/sync `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -ContentType "application/json" `
  -Body '{"instruments":["NIFTY50"],"windowDays":30}'
```

Both body fields are optional; the default is every instrument over the full
window.

---

## Storage and caching

Three layers, in the order a request touches them.

**1. In-process cache** (`lib/services/cache.ts`) — one provider call fetches the
whole 90-day window; the card, the history table and the charts all slice that
same cached result. The TTL depends on whether a session is live:

| State | TTL | Why |
| --- | --- | --- |
| No session in progress (every bar complete) | 1 hour | Nothing can change until the next session opens |
| A session is in progress | 5 minutes | The forward CPR's source bar is still forming |

Measured: cold request 119 ms, warm 17 ms; a subsequent `/api/cpr/history` and a
single-date `/api/cpr` were served from the same cached series in 19 ms and 14 ms
with no further provider calls.

**2. Database** (optional) — read first when `DATABASE_URL` is set, and
**written through**: a CPR computed live is persisted so it is not recomputed or
re-fetched next time. The write is scheduled with Next's `after()`, so it runs
once the response has been sent and adds no latency. It is best-effort — a
database failure is logged and the request still succeeds, because the app is
fully correct without a database.

> **With no `DATABASE_URL` set, nothing loads from the database at all.** Every
> figure is computed live and served from the in-process cache, and write-through
> is a no-op. `meta.context.fromDatabase` on every API response tells you which
> path served the request.

Because write-through fills the table gradually, a **partially populated database
is the normal state**, not an edge case. Stored rows are therefore served alone
only when they fully satisfy the request; otherwise they are merged with the live
series, with live winning on overlap (it is fresher, and after a futures contract
roll the stored rows still hold the previous contract's prices until the next
sync rewrites them).

| Query | Stored rows used alone when |
| --- | --- |
| `getHistory(days)` | at least `days` matching rows exist |
| `getRangeSeries(start, end)` | row count reaches the calendar's session count for the window |

The range test uses the calendar, which is an *upper* bound on real sessions (it
cannot know unlisted festival holidays), so it can never wrongly declare the
cache complete — at worst it falls back to an already-cached live series.
Returning whatever happened to be stored would silently show fewer sessions than
exist, which is the failure mode `tests/db-fallback.test.ts` guards.

So an upcoming date's CPR is calculated once and then served from storage. It is
safe to store because it is derived from a *completed* session and cannot change
until the next session closes. Synthetic (mock-provider) output is never
persisted.

**3. HTTP `Cache-Control`** — `s-maxage=3600` for settled history,
`s-maxage=300` for anything forward-looking.

### Reconciliation

A forward row is written for a date the *calendar* predicted. If that prediction
was wrong — an unlisted festival holiday, say — no session ever occurs on it and
the row would linger as phantom history. Each sync therefore deletes rows in the
window that observed sessions no longer produce; the count is reported as
`reconciledAway` in the sync response.

The stored `projected` flag is likewise re-evaluated on read: a row written as
tomorrow's forecast is simply history once that day has passed, and must not keep
claiming to be a projection.

## Vercel deployment

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new).
2. Framework preset: **Next.js** (auto-detected). No build overrides needed.
3. **Settings → Environment Variables**, for Production and Preview:
   - `DATABASE_URL` — Supabase **transaction pooler** URL
   - `CRON_SECRET` — the generated secret
   - `MARKET_DATA_PROVIDER` — `yahoo`
4. Deploy.
5. Run the migration once against the direct URL, then hit `/api/admin/sync` to
   backfill.

`npm run build` must pass before deploying; it is verified in this repo.

---

## Cron configuration

`vercel.json` registers two jobs:

| Path | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `/api/cron/sync` | `30 0 * * *` | Fetch, compute, upsert |
| `/api/cron/cleanup` | `0 1 * * *` | Delete rows older than the window |

00:30 UTC is chosen so that, at the moment it runs, the previous NSE session
(closes 10:00 UTC), the previous COMEX/NYMEX session, and the previous UTC crypto
day are all complete.

Vercel sends `Authorization: Bearer $CRON_SECRET`. Both endpoints also accept
`x-cron-secret` for manual calls. They **fail closed**: with no `CRON_SECRET`
set they return 401 rather than running unprotected.

> **Hobby plan:** limited to 2 cron jobs at daily granularity — which is exactly
> what is configured. On Pro you can add intra-day syncs (e.g. `0 11 * * 1-5`
> after the NSE close) by appending to the `crons` array.

Verify:

```bash
curl -s "$URL/api/cron/cleanup" -H "Authorization: Bearer $CRON_SECRET" | jq
```

---

## API reference

Every response is `{ ok: true, data, meta }` or `{ ok: false, error }`.

| Endpoint | Notes |
| --- | --- |
| `GET /api/health` | Deployment diagnostics: provider and database reachability with timings, plus config *shape* (never values). Safe to share. |
| `GET /api/instruments` | Registry grouped by category. |
| `GET /api/cpr?instrument=NIFTY50&date=2026-08-25` | Omit `date` for the default trading date. |
| `GET /api/cpr/history?instrument=NIFTY50&days=10` | Newest first. Optional `before=`, `category=`. |
| `GET /api/cpr/range?instrument=NIFTY50&start=…&end=…` | Backs the charts. Optional `category=`. |
| `GET /api/cpr/compare?date=…&instruments=A,B` | One row per instrument. Optional `category=`. |
| `POST /api/admin/sync` | Secret required. |
| `GET /api/cron/sync`, `GET /api/cron/cleanup` | Secret required. |

**A date with no CPR is not an error.** `/api/cpr` returns `200` with
`available: false` and a reason (`MARKET_CLOSED`, `OUT_OF_RANGE`,
`INVALID_SOURCE_BAR`, `NO_DATA`, `PROVIDER_ERROR`) plus a `suggestedDate` where
one exists — the UI needs to render "the market was closed", which is an answer,
not a failure.

Example:

```jsonc
{
  "ok": true,
  "data": {
    "instrument": "NIFTY50",
    "requestedDate": "2026-08-25",
    "horizon": "NEXT",
    "available": true,
    "record": {
      "tradingDate": "2026-08-25",   // the session these levels APPLY to
      "sourceDate": "2026-08-24",    // the completed session they came FROM
      "high": 24313, "low": 24144.3, "close": 24219.05,
      "bc": 24222.25, "pivot": 24225.45, "tc": 24228.65,
      "cprWidth": 6.4, "cprWidthPercent": 0.0264,
      "pointsClassification": "NARROW",
      "percentageClassification": "NARROW",
      "overallClassification": "NARROW",  // the category
      "classificationMethod": "POINTS",   // configured for this instrument
      "resolvedMethod": "POINTS",         // differs only on a FALLBACK
      "basis": "PRIMARY",
      "methodsAgree": true,
      "inverted": true,
      "projected": true
    }
  },
  "meta": { "context": { "provider": "yahoo", "isMockData": false } }
}
```

---

## Architecture

```
Market Data Provider  (lib/market-data/)   vendor-specific, swappable
        ↓ SessionBar[]  (complete sessions only)
CPR Engine            (lib/cpr/)           pure, deterministic, no I/O
        ↓ CPRResult
Service layer         (lib/services/)      calendar, cache, DB-or-live
        ↓ CPRRecord
API routes            (app/api/)           validation, envelope, caching
        ↓
UI                    (app/, components/)  server components + islands
```

```
lib/
  cpr/           calculator.ts  classification.ts  pivots.ts  types.ts
  market-data/   provider.ts  calendar.ts  holidays.ts  providers/{yahoo,mock}.ts
  db/            schema.ts  client.ts  repository.ts
  services/      cpr-service.ts  sync.ts  cache.ts  retention.ts
  instruments/   registry
  theme/         tokens.ts  ← single source of truth for colour
  api/           response.ts  validation.ts  auth.ts
  utils/         date.ts  number.ts  format.ts  cn.ts
```

`lib/cpr/` imports nothing from React, the database, or any provider. It can be
unit-tested in isolation, which is what `tests/cpr.test.ts` does.

---

## How CPR is calculated

From the **previous completed** session's H/L/C:

```
Pivot = (H + L + C) / 3
BC    = (H + L) / 2
TC    = 2 × Pivot − BC
```

**Inverted CPR.** When the raw arithmetic gives `BC > TC` the two are swapped so
`TC ≥ BC` always holds. This is common — the PRD's own reference example is one.
The swap is reported back as `inverted: true` and shown in the UI rather than
absorbed silently, because an inverted CPR is itself a signal.

```
Width   = TC − BC                     (2dp)
Width % = (Width / Pivot) × 100       (4dp)
```

**Rounding order.** Levels are rounded to 2dp *first*, then width is derived from
the rounded levels, then width % from the rounded width. So the printed TC minus
the printed BC always equals the printed width exactly. Deriving width from full
precision can disagree with the visible levels by a cent.

**Validation** (rejected, not silently zeroed): non-finite values, `high ≤ low`,
`close` outside `[low, high]`, a zero pivot, and any target date not strictly
after the source date.

### Two dates, always both shown

Each record carries **`tradingDate`** (the session the levels apply to) and
**`sourceDate`** (the completed session they were derived from). The PRD is
inconsistent about which one labels a row — §7's card uses the trading date while
§12's table uses the source date — so this app shows **both, labelled**, in the
card, the table and the API rather than picking one and hoping the reader guesses
right.

---

## Classification

Two independent methods run on every session and **both are always reported.**

| Width (points) | | Width % | |
| --- | --- | --- | --- |
| 1 – 40 | Narrow | 0.01 – 0.25 % | Narrow |
| 41 – 70 | Mixed | > 0.25 % and < 0.50 % | Mixed |
| 71 – 200 | Wider | ≥ 0.50 % | Wider |
| outside | out of range | < 0.01 % | out of range |

The published tables leave gaps: the points bands are integers (40.5 is
undefined) and the percentage bands jump from `0.26–0.49` to `≥ 0.50` (0.495 is
undefined). Both are closed without moving a stated boundary:

- **Points** bands are continuous, closed at the upper edge, so 40.5 → Mixed.
- **Percentage** anchors WIDER to its stated **0.50 % floor**, so everything
  above NARROW and below 0.50 % is Mixed. A width of **0.4914 % is Mixed, not
  Wider** — it has not reached the threshold the specification names.

Every published boundary still holds exactly: 40→Narrow, 41→Mixed, 70→Mixed,
71→Wider; 0.25→Narrow, 0.26→Mixed, 0.49→Mixed, 0.50→Wider.

Values are rounded to displayed precision *before* classifying, so a badge can
never contradict the number beside it — and `0.1 + 0.4`, which is
`0.5000000000000001` in IEEE-754, lands exactly on the floor rather than
tipping over it.

### Which method sets the category

Configured **per instrument** in `lib/instruments/index.ts`:

| Instrument | Method |
| --- | --- |
| **NIFTY 50** | **Points** |
| BANK NIFTY, SENSEX, Gold, Silver, Crude Oil, BTC | **Percentage** |

The points bands were calibrated against a NIFTY-scale index and do not
transfer. Measured on real sessions: Crude Oil at ~85 produces a CPR width of
**0.26 points** — below the 1-point floor entirely — while BTC at ~79,000
produces **616 points**, far above the 200 ceiling. Width % divides by the pivot,
so it stays meaningful at any price scale.

Resolution order:

| Configured method | Result | Category | `basis` |
| --- | --- | --- | --- |
| either | produced a band | that band | `PRIMARY` |
| either | out of range, other method banded | the other method's band | `FALLBACK` |
| either | both out of range | UNCLASSIFIED | `NONE` |

`FALLBACK` covers a value escaping its own scale — a 250-point NIFTY width is
past the ceiling, so percentage steps in. It is reported as a fallback, never
presented as the configured method's answer.

Live figures for one session, showing the rule in effect:

| Instrument | Width | Width % | By points | By percentage | **Category** | Decided by |
| --- | --- | --- | --- | --- | --- | --- |
| NIFTY 50 | 6.40 | 0.0264 % | NARROW | NARROW | **NARROW** | points |
| BANK NIFTY | 22.60 | 0.0393 % | NARROW | NARROW | **NARROW** | percentage |
| SENSEX | 84.28 | 0.1088 % | WIDER | NARROW | **NARROW** | percentage |
| Gold | 21.37 | 0.4643 % | NARROW | MIXED | **MIXED** | percentage |
| Silver | 0.33 | 0.4773 % | below range | MIXED | **MIXED** | percentage |
| Crude Oil | 0.26 | 0.2996 % | below range | MIXED | **MIXED** | percentage |
| Bitcoin | 616.24 | 0.7989 % | above range | WIDER | **WIDER** | percentage |

Both methods stay visible in the API and the UI, the deciding one is tagged
*decides*, and `methodsAgree` flags when the unused method would have said
something different — so the category is never mistaken for a consensus.

---

## Filtering by CPR category

Available on the dashboard, Historical Data and Instruments pages, and on three
API endpoints. State lives in the `category` query parameter, so a filtered view
is shareable and is rendered server-side rather than flashing unfiltered content
first.

```
?category=NARROW
?category=NARROW,WIDER
?category=all            # explicit no-op
```

Valid values: `NARROW`, `MIXED`, `WIDER`, `UNCLASSIFIED`, `all`.

```bash
curl "$URL/api/cpr/history?instrument=NIFTY50&days=30&category=MIXED"
curl "$URL/api/cpr/range?instrument=BTC&start=…&end=…&category=WIDER"
curl "$URL/api/cpr/compare?category=NARROW"
```

Behaviour worth knowing:

- **An unknown value is a 400, not a silent pass-through.** Returning unfiltered
  rows for `?category=NARWO` would read as "every session is narrow".
- **Selecting every category clears the filter** rather than encoding a no-op
  predicate.
- **`/api/cpr/history` returns the most recent `days` sessions THAT MATCH**, not
  the last `days` sessions with non-matching ones removed — so a filtered table
  fills up instead of thinning out. The heading says so, because those sessions
  can reach further back than the unfiltered window.
- **`/api/cpr/range` stays bounded by its dates**, so its count never exceeds the
  unfiltered total.
- Every filtered response includes `totalBeforeFilter`, and an empty result
  states that the filter is the cause and how many rows exist without it — an
  empty table is never mistaken for missing data.
- With a database configured the filter runs in SQL (there is an index on
  `overall_classification`); otherwise it is applied to the computed series.
- On the comparison table, a row with no CPR has no category, so any category
  filter necessarily hides it.

---

## Market calendar

Instruments do **not** share a calendar. NSE/BSE close on Indian holidays,
COMEX/NYMEX on US holidays, crypto never closes.

**For the past, observed sessions are authoritative.** Historical CPRs are built
by pairing consecutive sessions the provider actually returned, so real closures
— including festival holidays no rule can derive — are handled correctly.

**For the future, dates are projected** from weekend rules plus a holiday list,
and every projected date is flagged `projected: true` and labelled in the UI.

### What the holiday rules cover

Only exactly-derivable closures are encoded (`lib/market-data/holidays.ts`):
fixed dates, nth-weekday-of-month, and Good Friday via the Computus algorithm.

- **COMEX / NYMEX — complete.** All ten CME full closures are rule-derived,
  including the Saturday/Sunday observed shift.
- **NSE / BSE — partial.** Republic Day, Ambedkar Jayanti, Good Friday,
  Maharashtra Day, Independence Day, Gandhi Jayanti and Christmas are covered.
  **Diwali, Holi, Eid, Muharram, Ganesh Chaturthi, Dussehra and Guru Nanak
  Jayanti follow lunar calendars and are NOT derivable — they are not guessed.**

Add them from the exchange circular each year:

```ts
// lib/market-data/holidays.ts
export const EXTRA_HOLIDAYS: Record<string, ISODate[]> = {
  NSE: ["2027-03-22", "2027-11-05"],
  BSE: ["2027-03-22", "2027-11-05"],
};
```

Until you do, `holidayCoverage: "PARTIAL"` is returned in `meta.context` and the
UI states that a projected date may land on an unlisted holiday.

---

## Testing

```bash
npm test                        # 264 tests, hermetic and offline
npm run test:watch              # watch mode
```

The 21 live tests that hit the real provider are skipped by default. Opt in with
the `RUN_LIVE_TESTS` environment variable — the syntax differs per shell:

```bash
RUN_LIVE_TESTS=1 npm test                      # bash / zsh
```
```powershell
$env:RUN_LIVE_TESTS="1"; npm test              # PowerShell
```
```cmd
set RUN_LIVE_TESTS=1 && npm test               :: cmd.exe
```

| File | Covers |
| --- | --- |
| `tests/cpr.test.ts` | Levels, invariants, rounding, validation, pivot ladder |
| `tests/classification.test.ts` | Every published boundary, gaps, out-of-range, per-instrument method, fallback |
| `tests/filter.test.ts` | Category parsing, round-trip, filtering, API rejection of unknown values |
| `tests/calendar.test.ts` | Weekends, holidays, Friday→Monday, per-market calendars, timezones |
| `tests/api.test.ts` | Valid/invalid instrument, valid/invalid date, 90-day window, cron auth |
| `tests/theme.test.ts` | `tokens.ts` and `globals.css` cannot drift apart |
| `tests/env.test.ts` | Blank environment variables behave exactly like unset ones |
| `tests/settings-actions.test.ts` | Admin actions always resolve, authorise correctly, never echo the secret |
| `tests/settlement.test.ts` | A just-closed bar must be proven settled, not merely past its session clock |
| `tests/kite.test.ts` | Kite candle parsing, instrument lookup, session-end detection, expired-token handling |
| `tests/upstox.test.ts` | Upstox candle parsing, instrument master decoding, futures roll selection, MCX wiring |
| `tests/contracts.test.ts` | Futures month-code generation, year rollover, liquidity ranking |
| `tests/db-fallback.test.ts` | Database read path: sufficiency, merge, failure fallback, no mock persistence |
| `tests/db-integration.test.ts` | **Real Postgres**: migrations, constraints, upsert idempotency, numeric round-trip, retention, reconciliation |
| `tests/provider.live.test.ts` | Real vendor contract (opt-in) |

The CPR suite asserts against the specification's own worked example — the real
NIFTY 50 bar of 24 Aug 2026 (H 24,313.00 / L 24,144.30 / C 24,219.05) producing
BC 24,222.25, Pivot 24,225.45, TC 24,228.65, width 6.40, width % 0.0264 %,
NARROW.

---

## Known limitations

These are real and deliberate; none is silently papered over in the UI.

1. **MCX contracts need the Upstox provider.** Under the default `yahoo`
   provider, Gold/Silver/Crude are COMEX and NYMEX futures in USD, and the
   `*_MCX` instruments report `PROVIDER_LACKS_INSTRUMENT`. Switching to
   `upstox` makes the real MCX contracts available in INR. Every affected
   instrument says which it is.

2. **Futures contracts roll, so history can change retroactively.** The provider
   queries whichever contract month is currently most liquid, and the whole
   90-day window comes from that one contract — clean, with no roll discontinuity
   inside it. When the front month rolls, the window switches to the new contract
   and historical figures shift to that contract's prices. This is inherent to
   futures; the contract used is recorded on every row and shown in the UI.

   A CPR is still refused for any session whose source bar has no range
   (`open = high = low = close`), which the explicit contracts have eliminated in
   the sampled window but which remains possible.

3. **Indian festival holidays are not projected** (see above).

4. **Yahoo Finance is an unofficial endpoint.** No SLA, no support, subject to
   change or rate limiting. Fine for evaluation; swap it for a commercial feed
   before relying on it.

   It also returns *unsettled bars*, in two distinct ways.

   **Mid-session**, it stitches a live last price into `close` while the day's
   aggregated `high`/`low` still lag — observed on BTC-USD, close 79,769.17
   against a high of 79,643.41.

   **Just after the close**, the session clock says the session is over while the
   vendor has not finalised the bar. Observed on ^NSEI 14 minutes after the
   2026-08-25 close: O 24175.75 / H 24334.55 / L 24115.45 / C 24334.55 with
   **volume 0**, against 236,300 and 259,300 on the two preceding sessions —
   the close was simply the live last price. ^BSESN at the same moment reported
   a close *above* its high.

   A bar dated today is therefore treated as complete only when the session
   clock has passed **and** the bar is internally coherent **and** it carries
   volume (when that instrument reports volume at all). Otherwise the previous
   settled session is used: stale but correct, rather than fresh and wrong.

5. **Cross-instrument comparison can mix dates.** Markets run on different
   clocks, so at a given moment NIFTY's next CPR may be tomorrow's while COMEX's
   is still today's. Each row falls back to that instrument's most recent session
   and is marked "other date" with the date shown.

6. **The in-process cache is per-instance.** Serverless instances do not share
   it. The durable layer is the database plus HTTP `Cache-Control`.

7. **`npm audit` reports high-severity `sharp` advisories that are not
   reachable here.** `sharp` arrives as an optional transitive dependency of
   Next.js and is used only by `next/image`. This app renders **no** `<Image>`
   components and processes no user-supplied images, so the vulnerable libvips
   code path is never entered; on Vercel, image optimisation runs on Vercel's
   own infrastructure rather than this install. `15.5.23` is already the latest
   `15.5.x`, so the only upgrade path is Next 16, a major version — not worth
   the breaking change to patch an unreachable path.

   **This changes the moment you add `next/image`.** If you do, upgrade to
   Next 16 first.

8. **The UI has not been visually regression-tested.** Layout was verified
   structurally (server-rendered markup, responsive breakpoints, production
   build) but not by screenshot comparison across devices.
