# FollowUp

Reach hiring managers directly — not application black holes.

Static SPA on **GitHub Pages** + **Supabase** (Auth, Storage, Postgres RLS, Edge Functions). Hunter email enrichment and OpenAI run only on the server (Edge Function secrets). Confirmed outreach sends from the user’s **Gmail** with their resume attached.

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | Vite + React + TypeScript → GitHub Pages |
| Auth | Supabase Auth (Google sign-in) |
| Data | Postgres + RLS |
| Resumes | Supabase Storage (`resumes` bucket) |
| AI profile + drafts | Edge Functions → OpenAI |
| People / email | Edge Functions → [Hunter API v2](https://api.hunter.io/v2/) |
| Jobs signal | Remotive (free) + optional Adzuna |
| Send | Gmail API via dedicated OAuth (`gmail.send`) |

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From the repo root:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy
```

3. Set secrets:

```bash
npx supabase secrets set HUNTER_API_KEY=your_hunter_key
# Optional OSINT worker (local or hosted Python service from tools/email-discovery):
# npx supabase secrets set OSINT_WORKER_URL=http://127.0.0.1:8787
# npx supabase secrets set OSINT_WORKER_SECRET=your_shared_secret
npx supabase secrets set OPENAI_API_KEY=your_openai_key
npx supabase secrets set GOOGLE_GMAIL_CLIENT_ID=your_google_client_id
npx supabase secrets set GOOGLE_GMAIL_CLIENT_SECRET=your_google_client_secret
npx supabase secrets set APP_ORIGIN=https://YOUR_USER.github.io/FollowUp
```

Optional job board:

```bash
npx supabase secrets set ADZUNA_APP_ID=... ADZUNA_APP_KEY=...
```

People discovery (recommended — search uses all configured providers):

```bash
# Free Azure Bing Search (F0) — discovers LinkedIn profile URLs via web search
npx supabase secrets set BING_SEARCH_API_KEY=your_bing_key

# Optional paid alternatives
npx supabase secrets set SERPER_API_KEY=your_serper_key
npx supabase secrets set PROXYCURL_API_KEY=your_proxycurl_key
```

Hunter is **optional** (Filters → “Use Hunter.io”). When enabled, domain search returns up to **10 emails per domain** on the free plan. When Hunter is off or monthly credits are exhausted, email discovery uses the **OSINT pipeline** (site crawl, pattern guess, MX checks; optional `OSINT_WORKER_URL` for theHarvester).  
We do **not** scrape linkedin.com (ToS / blocks). Web search finds public LinkedIn URLs.

### 2. Frontend env

```bash
cp web/.env.example web/.env
```

Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase → Project Settings → API.

### 3. Google Auth (sign-in)

In Supabase → Authentication → Providers → Google: enable and add your OAuth client.

Add redirect URLs:

- `http://localhost:5173/app`
- `https://YOUR_USER.github.io/FollowUp/app`
- Supabase callback: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

### 4. Gmail OAuth (send)

Create a Google Cloud OAuth client (Web). Authorized redirect URI **must** be:

```
https://YOUR_PROJECT.supabase.co/functions/v1/gmail-oauth
```

Enable Gmail API on the project. Scopes used: `gmail.send` + `userinfo.email`.

Use the same client id/secret in `GOOGLE_GMAIL_*` secrets (or a dedicated client).

### 5. Local dev

```bash
cd web
npm install
npm run dev
```

### 6. GitHub Pages

Push to `main`. The workflow builds `web/` with `VITE_BASE_PATH=/FollowUp/` and deploys `web/dist`.

Add repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

In GitHub → Settings → Pages → Source: **GitHub Actions**.

If your repo name is not `FollowUp`, set `VITE_BASE_PATH` in the workflow to `/YourRepoName/`.

## App flow

1. Sign in with Google  
2. Upload resume → parse text  
3. Chat to build / finalize search profile  
4. Tune include/exclude title filters  
5. Run people search (jobs → companies → Hunter contacts)  
6. Draft emails → review → Connect Gmail → send with resume  

## Edge Functions

| Function | Role |
|----------|------|
| `parse-resume` | Extract text from uploaded file |
| `chat-profile` | LLM profile interview + JSON profile |
| `run-search` | Remotive/Adzuna + Hunter domain/email |
| `draft-emails` | LLM outreach drafts |
| `gmail-oauth` | Start + callback for Gmail tokens |
| `send-outreach` | MIME email + resume via Gmail API |

## Hunter note

Store `HUNTER_API_KEY` only as a Supabase secret. Do not put it in the SPA or commit it. Cursor MCP setup from [hunter.io/agents.md](https://hunter.io/agents.md) is optional for local agent use — the product calls REST `https://api.hunter.io/v2/` from Edge Functions.
