# Deployment — GitHub → Vercel

Everything that can be automated is done. The remaining steps need your GitHub,
Vercel and Supabase logins, so they are yours to run.

The repo is committed and clean: **no secrets are in git**. `.env.local` is
git-ignored and every credential lives in the Vercel dashboard.

---

## 1. Push to GitHub

Create an empty repo (no README, no .gitignore — this repo already has both),
then:

```powershell
git remote add origin https://github.com/<you>/cpr-analytics.git
git push -u origin main
```

With the GitHub CLI it is one command:

```powershell
gh repo create cpr-analytics --private --source=. --push
```

---

## 2. Create the Supabase database

1. [supabase.com](https://supabase.com) → **New project**. Save the database
   password when it is shown — it is not retrievable later.
2. **Settings → Database → Connection string.** Copy **both**:

Supabase offers three. Identify them by **hostname and port**, which stay
constant even as the dashboard UI changes:

| Mode | Host / port | Use for | Notes |
| --- | --- | --- | --- |
| **Transaction pooler** | `aws-0-<region>.pooler.supabase.com:6543` | `DATABASE_URL` (app + Vercel) | Serverless-safe; Vercel opens many short-lived connections |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com:5432` | `DIRECT_DATABASE_URL` (migrations) | Full Postgres protocol, and reachable over **IPv4** |
| **Direct** | `db.<ref>.supabase.co:5432` | migrations, *if* you have IPv6 | **IPv6-only** — fails on most home/office networks and on Vercel |

**Use the session pooler for migrations unless you know you have IPv6.** Both it
and the direct connection run DDL correctly, but the direct host resolves only
over IPv6, so on a typical IPv4 network it fails with `ENETUNREACH` — which
looks like a credentials problem but is not.

URL-encode special characters in the password: `@` → `%40`, `#` → `%23`,
`/` → `%2F`. An un-encoded `@` is the most common cause of an auth failure.

---

## 3. Apply migrations (from your machine, once)

Vercel does not run migrations. Put the **session pooler** string (port 5432) in
`.env.local` as `DIRECT_DATABASE_URL`:

```bash
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

```powershell
npm run db:migrate
npm run db:check
```

`db:check` should report:

```
  ✓ Connected — PostgreSQL 15.x
  ✓ Table cpr_data exists
  ✓ All 6 indexes present
  ✓ Table is empty — 0 rows
```

---

## 4. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** the GitHub repo.
2. Framework preset **Next.js** is detected automatically. Do not override the
   build command, output directory or install command.
3. **Do not deploy yet** — add the environment variables first (next step).

---

## 5. Environment variables — in the Vercel dashboard only

**Project → Settings → Environment Variables.** Nothing below belongs in the
repo; the app reads all of it from the platform at runtime.

| Variable | Value | Environments | Required |
| --- | --- | --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** string (port 6543) | Production, Preview | For storage |
| `CRON_SECRET` | 64-char random hex | Production, Preview | For cron + admin actions |
| `MARKET_DATA_PROVIDER` | `yahoo` | Production, Preview | No — defaults to `yahoo` |
| `DATA_RETENTION_DAYS` | `90` | Production, Preview | No — defaults to `90` |

Generate the cron secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Notes:

- **Do not** set `DIRECT_DATABASE_URL` on Vercel. It is IPv6-only and is only
  used by local migrations.
- **Do not** set `MARKET_DATA_PROVIDER=mock` in production. The provider factory
  throws rather than serve synthetic prices as if they were real.
- No variable is prefixed `NEXT_PUBLIC_`, so none of this reaches the browser.

Then **Deploy**.

---

## 6. After the first deploy

**Verify the deployment:**

```powershell
$URL = "https://<your-project>.vercel.app"
Invoke-RestMethod "$URL/api/cpr?instrument=NIFTY50" | ConvertTo-Json -Depth 5
```

Check `meta.context.isMockData` is `false` and a `record` is present.

**Backfill the database.** Cron runs at 00:30 UTC, but you can populate it now:

```powershell
Invoke-RestMethod -Method Post -Uri "$URL/api/admin/sync" `
  -Headers @{ Authorization = "Bearer <CRON_SECRET>" }
```

Or open `/settings` → **Data synchronisation**, choose *All instruments*, paste
the secret and press **Sync now**.

**Confirm storage is being read.** Request the same instrument twice and check
that `meta.context.fromDatabase` becomes `true`.

**Confirm cron registered.** Vercel dashboard → **Cron Jobs** should list:

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/sync` | `30 0 * * *` |
| `/api/cron/cleanup` | `0 1 * * *` |

> Vercel's **Hobby** plan allows 2 cron jobs at daily granularity — exactly what
> `vercel.json` declares. On Pro you can add intra-day syncs (e.g. `0 11 * * 1-5`
> after the NSE close) by appending to the `crons` array.

---

## Redeploying

`git push` to `main` triggers a production deploy. Pull requests get preview
deployments automatically.

Schema changes need a migration run from your machine against the **direct**
connection before the deploy that depends on them:

```powershell
npm run db:generate    # after editing lib/db/schema.ts
npm run db:migrate
git add drizzle/ lib/db/schema.ts && git commit -m "..." && git push
```

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails on `next build` | Run `npm run build` locally first — it must pass before pushing. |
| `/settings` shows "Configured but unreachable" | You used the direct (5432) string on Vercel. Switch to the pooler (6543). |
| Auth failure connecting | Un-encoded `@` or `#` in the password. |
| `ENETUNREACH` on migrate | You used the direct `db.<ref>.supabase.co` host, which is IPv6-only. Use the session pooler (`pooler.supabase.com:5432`). |
| Forgot the database password | Supabase → Settings → Database → **Reset database password**. The connection strings change with it. |
| Cron returns 401 | `CRON_SECRET` missing on Vercel, or set only for Preview and not Production. |
| Sync button says "disabled" | `CRON_SECRET` is not set — the action fails closed by design. |
| Data looks synthetic, red banner shows | `MARKET_DATA_PROVIDER` is set to `mock`. Remove it or set `yahoo`. |
