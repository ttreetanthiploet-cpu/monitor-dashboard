# n8n AI Agent Monitor — Dashboard

A single-page monitoring dashboard for your n8n AI agent workflows.
Reads directly from your Supabase database populated by the n8n-monitor service.

## Deploy to Vercel

There are two simple ways to deploy this static dashboard to Vercel: via Git (recommended) or using the Vercel CLI.

A. Deploy via GitHub (recommended)

1. Create a new GitHub repository and push this folder:

```bash
cd claude/n8n-dashboard
git init
git add .
git commit -m "Initial n8n-dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

2. On vercel.com → New Project → Import Git Repository → select your repo.
3. In Project Settings → Environment Variables, add the following (see `.env.example`):
	- `SUPABASE_URL` = your Supabase URL
	- `SUPABASE_ANON_KEY` = your anon key
4. Deploy. The current `vercel.json` serves `index.html` as a static site.

B. Deploy with Vercel CLI (quick, from your machine)

1. Install Vercel CLI if needed:

```bash
npm i -g vercel
# or
pnpm add -g vercel
```

2. Login and deploy:

```bash
cd claude/n8n-dashboard
vercel login
vercel --prod
```

3. Add environment variables to the project (CLI) or in the Vercel dashboard:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
```

Notes
- This repository is a static, client-side dashboard that requires the Supabase `anon` key to read data from the browser.
- For private dashboards consider enabling Row Level Security (RLS) in Supabase and adding server-side auth.
- Do not commit secret keys to the repo. Use Vercel Environment Variables.

## Run locally (preview)

You can preview the dashboard locally before deploying. The app stores Supabase credentials in the browser `localStorage` (entered via the on-screen form), so you don't need to add files to the repo.

Option A — Python (no Node required)

```bash
cd claude/n8n-dashboard
# serves files at http://localhost:4000
python3 -m http.server 4000
```

Option B — Node (npx serve)

```bash
cd claude/n8n-dashboard
npx serve -s . -l 4000
```

Then open http://localhost:4000 in your browser. On first load the config overlay will prompt for `Supabase URL` and `Anon key` — enter them and click Connect.

Tip: to prefill credentials from your browser console (skip the overlay), run:

```javascript
localStorage.setItem('sb_url', 'https://your-project-ref.supabase.co');
localStorage.setItem('sb_key', 'your-anon-key');
window.location.reload();
```

CORS / network notes
- Serving over `http://localhost` is fine for Supabase requests. Do not open `index.html` via `file://` — that may block network modules.
- If you see permission/401 errors, verify the `anon` key and that your Supabase table policies allow public `SELECT` for the `anon` role.

Local helper script
- A small helper script `run-local.sh` is included to start a local server (uses Python 3 if available, else falls back to `npx serve`).

## First use

On first load, the app will ask for your Supabase credentials:
- **Supabase URL**: `https://your-project-ref.supabase.co`
- **Anon key**: found in Supabase Dashboard → Settings → API → `anon` key

Credentials are saved to `localStorage` so you only enter them once per browser.

## Features

| Tab | What it shows |
|---|---|
| Overview | Volume, success rate, avg latency, cost, recent executions |
| AI performance | Token usage, cost per request, avg cost per turn by route |
| Sub-workflows | Activation rates, per-workflow latency & cost |
| Guardrails | Pass rates, NSFW/hallucination flags, event log |
| Routing | Route distribution, escalation rate, trend over time |
| Errors | Error feed, HTTP failures, guardrail blocks |
| Logs | Full searchable execution log with drill-down drawer |

## Supabase RLS note

The dashboard uses the `anon` key. If you want to restrict access,
enable Row Level Security on your tables and add a policy that allows
`SELECT` for authenticated users only, then add Supabase Auth.

For a private internal dashboard without auth, using the `anon` key
with no RLS (as set up during the SQL step) is fine.
