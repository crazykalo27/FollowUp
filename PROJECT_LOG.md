## 2026-08-16 — Tomba.io email discovery

- Optional Tomba provider in Settings (off by default), same pattern as Apollo/Hunter.
- Search pipeline: Apollo → Tomba → Hunter → OSINT. Tomba does domain-search (up to 10 people/company) plus per-contact email-finder.
- Supabase Edge secrets need **both** `TOMBA_API_KEY` (API key / `X-Tomba-Key`) and `TOMBA_SECRET` (secret / `X-Tomba-Secret`; `TOMBA_API_SECRET` also works). Neither key goes in the database; the Settings toggle only turns the feature on.
- Reads `TOMBA_SECRET` (the name already set in the project) as well as `TOMBA_API_SECRET`.

## 2026-08-13 — Contacts Drafted tab

- Renamed the Archived contacts tab to **Drafted**.
- Creating an outreach draft (or already having one) moves the contact out of Kept into Drafted.
- Move to Kept returns them to the Kept list.

## 2026-08-13 — Orientation chips match the current question

- Experience/seniority shows Entry / Mid-level / Experienced (not Large / Medium / Small).
- Chip set is chosen from the latest AI question text first, then `orientation_q`.

## 2026-08-13 — Orientation quick-answer buttons back

- Stopped gating chips on app-level `orientation.complete` (leftover drafts/complete hid them mid-interview).
- Detect current closed-ended question from latest AI message + `orientation_q`.
- Off-topic pauses re-attach the “press the buttons” hint so chips stay available.

## 2026-08-12 — Discard: doesn't match job filters

- New discard chip: **Doesn't match job filters** — person may be at the company but isn't a fit for the user's job/people targeting.
- Gradient refine downranks that title in people-to-find when this reason is used.

## 2026-08-12 — Contacts kept = all-time

- Search chip “Contacts found / kept” counts `contact_decisions` with decision=keep (lifetime), not current `review_status=kept`.
- Archive/delete no longer lowers the kept number; migration keeps decision rows when contacts are deleted (`contact_id` set null).

## 2026-08-12 — General profile/filter retune (any niche)

- Profile chat returns `remove_terms` / `add_terms` for whatever the user asked (Founder/CEO, technical→painting, etc.).
- Server deterministically scrubs/adds those across outreach (“People to find”), roles, industries, then regenerates filters with ban/prefer lists.
- Synonym expand only helps matching user-named terms (e.g. founder→co-founder) — not a fixed ban list.

## 2026-08-12 — Strip Founder/CEO from People to find

- Filters “People to find” is `outreach_targets`; remove prompts now deterministically scrub Founder/CEO/Entrepreneur there (not only in chat prose).
- Filter regen won’t invent those titles into include_titles unless the profile still lists them; on drop prompts they go to exclude.
- Filters page refreshes targets on focus so Profile chat updates show up.

## 2026-08-12 — Profile chat add/remove rewrites

- Freeform coach treats “remove X” / “add Y” as updates: full profile rewrite around that change, then filter refresh.
- Removals delete matching targets (never add the rejected topic); additions integrate and refigure related fields.
- Server applies authoritative rewrite (empty arrays clear); guards against accidental total wipe.

## 2026-08-12 — No hardcoded Founder/CEO people queries

- LinkedIn SERP queries are general company (`site:linkedin.com/in "Company"`) plus filter-driven title batches / niche / location.
- Removed hardcoded Founder/CEO/leadership and recruiter OR clauses; those titles only appear if Filters include them.
- Retry broaden still pulls from shared `BROAD_PEOPLE_TITLES` (eng/seniority pool), not leadership injects.

## 2026-08-12 — Explain empty LinkedIn people search

- People search leads with general company queries, then filter title ORs.
- Report shows Bing/Serper queries, SERP hit counts, profile URLs kept/dropped.
- Diagnosis distinguishes “0 SERP hits” vs “hits dropped as wrong company” vs missing API keys.
- Niche keywords no longer include size words like “large/medium/company”.

## 2026-08-12 — Richer, simpler Search report

- Per-company filter funnel: found → passed → kept, plus reject samples (wrong company, excluded, low score, no email).
- Report UI: Looking for / funnel / by company; source stats collapsed.
- Empty-run diagnosis uses real reject reasons instead of a generic “outreach threshold” line.

## 2026-08-12 — Temporary loosen on company people retries

- On each empty company retry, pick one unused aspect and loosen ~15% for that pass only:
  broader titles, fewer niche keywords, softer title-fit score, or weaker location/light focus.
- Does not update profile niches / filters / gradient for future searches.
- Progress log: `temporary loosen · <aspect>`.

## 2026-08-12 — Search contacts found / kept stat

- Search page stat chip: **Contacts found / kept** as `total / kept` (same ratio style as Emails sent / drafts).

## 2026-08-12 — Domain resolve via live web search

- Domain AI now uses the same `web_search` tool pattern as company discovery (Bing/Serper).
- First turn forces a tool call; prompt tells the model not to answer from memory alone.
- Progress logs: “resolving domain via AI web search”.

## 2026-08-12 — Contacts search + sort

- Search bar filters Review / Kept / Archived by name, title, location, company, email, match reason.
- Sort: most recently added, most recently kept (from keep decisions), alphabetical.
- Select-all / bulk actions operate on the filtered list.

## 2026-08-12 — Drop filter run-limit settings

- Removed **Max companies / run** and **Max contacts / company** from Filters UI.
- `run-search` uses Search **sizing** depth caps only (Low/Medium/High/Calibration).
- AI recommend-filters no longer writes those fields; legacy keys stripped via one helper on load / email-settings save.

## 2026-08-12 — Fix website location display path

- Earlier location “tests” were offline fixtures, not the live Bing → `run-search` → DB → Contacts card path.
- Synced `web/src/lib/linkedin_location.ts` with the edge parser.
- Contact cards now **trust** `contacts.location` / `source_details.websearch.location` from the pipeline instead of re-filtering them away.
- Re-parse snippets on the client as fallback (including `Location:` labels and `serp_title`).

## 2026-08-12 — Live LinkedIn location extraction

- Verified against live SpaceX / Stripe / NVIDIA LinkedIn hits (e.g. Nate Hancock → Greater Seattle Area).
- Also reads bare geo lines with `(US)` suffix when `Location:` is missing.
- Test: `node scripts/test-linkedin-location-live.mjs`

## 2026-08-12 — LinkedIn SERP → contact card extraction

- Card fields (name, title, location) parsed from LinkedIn *search result* titles/snippets — e.g. `Nate Hancock - ASIC/FPGA Design Engineer @ SpaceX` plus `Experience:` / `Location:` labels.
- Strips `@ Company` / `at Company` from the role shown on the card.
- When heuristics miss a field, OpenAI fills from the same SERP text (does not change who was found).
- Fixture script: `node scripts/test-linkedin-serp.mjs`

## 2026-08-12 — Strict company→people pipeline

- Invariant for every company loop: find people **at that company**, then match role — never keep role-only SERP hits.
- Employer check always on (all search modes): require company in LinkedIn title/headline; reject `at OtherCo` and foreign dash segments; snippet-only mentions are not enough.
- Filter wrong-company candidates before OSINT; LinkedIn queries put `"CompanyName"` first.

## 2026-08-12 — Wrong company discard + strict employer match

- New discard chip **Wrong company** (AI learns via dislikes + avoid company list; not treated as an industry miss).
- Application / specific-company search: drop LinkedIn hits that say “at OtherCo” or lack any evidence of the target employer (fixes SpaceX cards that were really Amazon Leo).

## 2026-08-12 — Drop publisher domain skip-list

- Removed the denylist that blocked YouTube, Facebook, LinkedIn, news sites, etc. as employer domains.
- Domain resolve trusts OpenAI; only basic hostname shape is checked (must look like `example.com`).

## 2026-08-12 — Fix domain skip-list blocking SpaceX

- Root cause of “Skipped — could not resolve domain”: publisher skip used raw `.includes('x.com')`, which also matched **spacex.com**, **box.com**, **netflix.com**.
- Host matching is now domain-boundary aware; AI still resolves domains, with clearer error logs when it fails.
- Regression script: `node scripts/test-company-domain.mjs` (optional `--live` with `OPENAI_API_KEY`).

## 2026-08-12 — Domain resolve via AI only

- Company domains come **only** from OpenAI (no slug guesses, web-search lookalikes, or per-company hardcodes).
- Progress logs: “resolving domain through AI” and `Resolved … (domain · AI)`.
- Edge functions must be redeployed for this to affect production (deploy workflow still disabled / missing token).

## 2026-08-12 — OpenAI company domain resolution

- Resolve employer domains via OpenAI (“official website + common @email”) instead of trusting web-search lookalikes (e.g. SpaceX → spacex.com, not spacecrew).
- Used for specific/application company targets and before people search; drops mismatched domains from AI company discovery.

## 2026-08-12 — Stronger one-sentence application fill

- Always rewrite application `job_description` (never keep multi-sentence AI dumps).
- Ban certainty phrasing (“I will be developing…”, “In this position…”); keep one short personal “I applied…because I am interested in…” line tied to the person/project.

## 2026-08-12 — Application role: one-sentence draft fill

- `[job description]` is now a single first-person sentence: “I applied for [role] because I am interested in [detail related to the person found].”
- Interest clause prefers JD projects/responsibilities that overlap the contact’s title; drafts regenerate this on send/create.

## 2026-08-12 — Auto-retry guessed emails on bounce

- When a **guessed** outreach address bounces, keep the draft pending and resend with the next name pattern (first.last → flast → firstlast → …), up to 5 attempts.
- Found/public emails still mark bounced immediately. Exhausted guesses mark bounced with a clear note.
- Shared Gmail send helper used by initial send and bounce retries.

## 2026-08-12 — Looking for prefs on Filters

- Moved employment / remote prefs from Settings into a compact “Looking for” chip section at the bottom of Filters.
- Also surfaces company size and seniority from the profile interview; saved with the rest of search targets.

## 2026-08-12 — Profile chat: FollowUp-aware coach

- After the orientation interview, chat answers FollowUp product questions and profile/filter questions without rewriting targets by default.
- Detects update intent and writes profile / refreshes search filters only when the user asks for a change.
- Mid-interview off-topic questions (about the app or profile) get answers without advancing the questionnaire.

## 2026-08-12 — Profile chat: padding above compose bar

- Last coach message no longer sits flush on the input bar; spacer under the message log plus a bit more compose top padding.

## 2026-08-11 — Drafts tab: instant switch via background prefetch

- Shared drafts cache warms while browsing other app pages; Drafts hydrates from cache on mount.
- Outbox load no longer waits on Gmail delivery sync (sync runs after, then refreshes list only).
- Contacts draft/generate actions refresh the cache so the outbox is ready on navigate.

## 2026-08-11 — Live email deliverability check (no send)

- New `verify-email` Edge Function: MX check + optional SMTP RCPT via OSINT worker; Hunter verifier when enabled.
- Settings toggle `enable_smtp_verify`; test any address on Settings; "Check deliverability" on Contacts and Drafts.
- Connected Gmail address used as SMTP MAIL FROM for probes (no message to recipient). Post-send bounce scan unchanged.

## 2026-08-11 — Apollo email enrichment; Proxycurl removed

- Apollo.io `people/match` integrated for optional email lookup (`enable_apollo` in Settings, `APOLLO_API_KEY` secret).
- Email pipeline order when enabled: Apollo → Hunter → OSINT (sequential; skip later steps if email found).
- Apollo location always overrides web-inferred location; Apollo enrichment runs even when email already known.
- LinkedIn location heuristics tightened — reject job titles/headlines (e.g. "Director, Engineering"); prefer trailing SERP segments and geo signals.
- Proxycurl people search and profile backfill removed/disabled.
- Web search (LinkedIn) + OSINT remain the default people/email discovery path.

## 2026-08-11 — Email provenance on contact cards

- Contact cards show whether the email was **Found** (Hunter / company site / web) or **Guessed** (name pattern), plus verification (verified / likely / MX-only).
- New contacts store `source_details.email_provenance`; older contacts derive the same labels from sources + verification status.

## 2026-08-10 — Application search: JD-only targeting

- Application mode no longer merges profile roles/industries/filters into people search; titles and keywords come from the pasted job description only.
- Sanitize extracted job titles (drop soft-skill fluff like “adaptive, self-motivated…”) and score RTL/hardware design titles for ranking.
- Application report shows role/people titles instead of profile industries/job-board stats; clearer empty-result diagnosis.

## 2026-08-10 — Minimalist Search tab redesign

- Search flows (General / Specific / Application) are icon cards with one-line purposes; picking one reveals numbered steps (target → size → run), so the flow reads visually instead of via paragraphs.
- Big centered Run search button in the card footer with a one-line run summary (companies/people/ETA or target person count); Extract details lives with the paste step.
- Removed the standalone flow rail and long explainer copy; all features (modes, size picker, people target, extract fields, cancel, progress, report) unchanged.

## 2026-08-10 — Block dice.com emails in search

- People search drops any `@dice.com` email (Hunter, OSINT, and before saving contacts).

## 2026-08-10 — Keep reason: Great application connection

- Contacts keep chips include “Great application connection”; preference learning boosts similar titles.

## 2026-08-10 — Application extract UX + location targeting

- Extract button moved next to Search and centered; larger primary actions.
- Job parse extracts optional **location** (user can fill if missing); used as a high-priority people-search / ranking signal.
- Role summary is first-person (“I applied for…”); exact project + summary tokens used lightly in search.

## 2026-08-10 — Application search + multi-template drafts

- Search modes: **General** / **Specific** / **Application**. Application pastes a job description, extracts company/role/projects, and finds technical peers (exact or more senior nearby) at that employer for referral follow-up.
- Contacts from Application runs carry `application_context`; email templates support `[job description]` (and `[job_description]`).
- Drafts: dropdown of named templates with add/rename; active template drives new drafts; new “Application follow-up” starter preset.
- New Edge Function `parse-job-posting`; `run-search` + `draft-emails` updated.

## 2026-08-08 — Contrastive discard-note polarity

- Notes like “fusion not embedded automotive” parse as REJECT fusion / PREFER embedded automotive.
- Preference docs, gradient refine, and filter rewrite all use that polarity explicitly.

## 2026-08-08 — Orientation search lock + full second review

- After a calibration search finishes, Search only offers Review contacts (no second run).
- Second contact pass reviews everyone again, then opens Kept to pick one for a draft.

## 2026-08-08 — Hide calibration depth from Search picker

- Search size cards never offer Calibration; orientation still forces that depth automatically.

## 2026-08-08 — Profile chat padding + drafts Outbox

- Profile conversation: more bottom padding so the last message isn’t flush with the composer edge.
- Drafts list label renamed Inbox → Outbox.

## 2026-08-08 — Orientation preference gradient calibration

- Resume bootstrap extracts SPECIFIC industry niches (not generic “tech”).
- Orientation flow: profile → filters → 4-person calibration search → review all with reasons → preference gradient refine (~10% exploration) → second search → keep a contact → drafts.
- New `refine-targets` Edge Function + `preferenceGradient` module updates industries/roles/filters from keep/discard signals.
- Refine page explains the optimization steps in plain language; search depth `orientation` caps ~4 contacts.

## 2026-08-08 — Orientation quick-answer buttons

- Profile chat: closed-ended orientation questions (employment type, remote, company size, seniority; plus “No preference” for location) show clickable options that auto-send.
- Open-ended steps (industries, roles) stay free-text; typing still available on button steps.

## 2026-08-08 — Gmail bounce detection + draft recovery

- Gmail OAuth adds **readonly** scope; reconnect in Settings to scan threads for delivery failures.
- `check-outreach-replies` marks drafts **bounced** (red in UI, not counted as sent); “Find new person at this company” prefills Specific search.
- Search stats: **emails sent / drafts** chip.

## 2026-08-07 — Search modes: general vs specific company

- Search page: **General** / **Specific** pill toggles; specific mode picks **1, 2, or 5** people with up to 3 retry rounds.
- `run-search` accepts `search_mode` + `target_company`; skips AI discovery for company mode, resolves domain via web search, stores mode in pipeline meta.

## 2026-08-07 — LinkedIn contact location parsing

- Fixed web-search location heuristics: no longer treat first snippet segment (often About) as location; scan for geo patterns and segment before “connections”.
- Merge prefers Proxycurl location over Bing/Serper guesses; optional Proxycurl profile lookup (≤5/company) when URL known but location missing.


## 2026-08-05 — Greenfield MVP

- Chose GitHub Pages SPA + Supabase backend (Auth, Storage, Postgres RLS, Edge Functions).
- Product idea: find hiring managers (not HR recruiters), enrich emails via Hunter REST, draft outreach, send from the user’s Gmail with resume attached.
- Scaffolded Vite/React TypeScript frontend under `web/`, Supabase migrations and Edge Functions under `supabase/`.
- Pipeline: resume upload → AI search profile → tunable title filters → job APIs + Hunter domain/email → draft review → Gmail OAuth send.
- Shipped MVP surface: landing, overview, profile chat, filters, contacts, drafts, settings; GH Pages workflow + README secrets docs.
- Edge Functions: `parse-resume`, `chat-profile`, `run-search`, `draft-emails`, `gmail-oauth`, `send-outreach`.
- Profile chat: one question at a time; resume upload bootstraps/scans and seeds profile; incremental updates; “use as-is” anytime.
- Bootstrap now runs a dedicated resume extraction pass that aggressively fills skills, industries, roles, locations, and seniority before the first question.
- Search report UI: shows job query, sources (Remotive/Adzuna), include/exclude titles, and per-company Hunter outcomes so 0-contact runs are diagnosable.
- Multi-source people search: Hunter + Apollo + Proxycurl; source effectiveness cards; contact cards with LinkedIn, hiring signal, found-via pills, draft CTA.
- Dropped Apollo (paid-only). Hunter capped at 10/domain. Added free Bing/Serper web search for LinkedIn URLs (no LinkedIn scraping).
- Live search progress UI: search_runs table + polling bar with stage, %, current company.
- Search persists across navigation; Quick/Standard/Deep depth scales with ETA and contact estimates.

## 2026-08-05 — Contact swipe review + preference learning

- Contacts page is one-card-at-a-time Keep / Discard; discard opens reason chips that teach the model.
- Preference documents (`likes_doc` / `dislikes_doc` + AI memo) store what the user liked vs rejected; visible on Filters.
- After resume scan / profile finalize, AI writes `search_filters` from resume + chat + prefs (`recommend-filters` / chat-profile).
- `review-contact` Edge Function records decisions and nudges exclude titles on recruiter discards.

## 2026-08-05 — Industry-first company discovery

- Flipped search pipeline: industry company discovery (Serper/Bing) before job boards; jobs only supplement hiring signals.
- People search uses department keywords + broad outreach titles; contacts ranked by outreach title score (not strict hiring-manager match).
- Filter AI widened to senior ICs/researchers; recruiters optional fallback instead of hard exclude.

## 2026-08-05 — Role confirm gate + profile-specific search

- After resume upload, AI lists proposed target roles; user must reply to confirm/change before “use as-is” or filters lock.
- Search runs multiple job queries from confirmed roles (+ industries), ranks companies by role/industry fit, and biases LinkedIn people search with those domain keywords.

## 2026-08-05 — Contacts carousel + deck list

- Contacts review: optimistic keep/discard with background sync queue; AI preference memo no longer on every discard.
- Favorite / discard-all-company actions; companies.user_flag drives search rank and avoid list.
- Keep feedback chips; Kept tab archive / discard / delete; archived tab (neutral, no AI dislike).
- Shared `recommendFiltersForUser`: profile/preference learning auto-syncs `search_filters` (review + chat).
- Profile chat targets desired jobs/industries/company types and outreach_targets (who to email); resume skills are background only.
- Search skips people already in contacts (pending, kept, discarded, archived) by email, LinkedIn, or name+company.
- Welcome setup: required full name + optional links for email signatures; drafts never use placeholder brackets.
- Review UI keeps Tinder swipe/buttons on a highlighted card; all pending contacts show below and clicking one promotes it to the carousel.
- Contacts cards: labeled detail grid (role, company, email, LinkedIn, signal, why surfaced); carousel shows one neighbor each side at ~80% scale recessed behind center.
- Contact `location` on cards (DB column + LinkedIn/Proxycurl capture on new searches; older websearch rows infer from snippet when possible).

## 2026-08-05 — Settings mirrors profile + sender

- Settings: editable search targets (jobs, industries, company types, people to find, notes) with filter sync via `recommend-filters`.
- Settings: email signature fields (same as welcome); gate allows Settings before welcome complete; Profile sidebar links to Settings.

## 2026-08-05 — Employer vs publisher company discovery

- Web company discovery: skip blogs/newsletters/aggregators; extract employers from LinkedIn company links in listicles; validate names before save.
- Canonical employer names via Hunter organization + domain; job-board names win over bad web titles.
- Broader industry queries (startups, Fortune 500, labs, LinkedIn company search, careers).
- Drafts page: Regenerate draft re-runs LLM on same contact (updates row, not sent).
- Search targets UI moved to Filters tab; Settings is signature + Gmail only.
- run-search: parallel provider calls, lower deep caps, 125s budget + clearer 546 message; profile/gmail load fallbacks.
- Overview: Cancel search marks run cancelled (RLS); run-search respects cancel; stuck-search cancel after client errors.
- Email templates on Drafts (placeholders + save); draft-emails fills tags; Settings job prefs; profile chat asks employment/remote.

## 2026-08-06 — In-house email discovery design

- Hunter free tier: keep domain-search (10/domain); plan to replace per-contact email-finder/verifier with public OSINT + MX/SMTP.
- Hunter optional in Filters (`enable_hunter`); OSINT email pipeline (Edge crawl + pattern + optional worker) when Hunter off or quota exhausted.
- Deployed Edge Functions to Supabase project `czakwfzjkhsaysvqeswc` (includes `run-search` + `email_discovery.ts`).
- Search: queued pipeline (`pipeline_state`) — one company per Edge invocation, auto-chains via service role; lighter OSINT (sitemap, ≤1 Bing-preferring email snippet search/company).

## 2026-08-06 — Rich search progress UI

- `search_runs.progress_meta`: per-company step bars + scrolling activity log; `run-search` writes granular steps (discovery, OSINT, saves).
- Overview: overall progress bar, per-company mini bars, live activity feed; overall % derived from plan + company queue.
- Filters: Hunter / verified-email toggles auto-save to `search_filters`; AI filter rewrite keeps your saved toggles.
- Email discovery (Hunter, verified email) moved to Settings; persisted in `search_filters` with explicit save + reload.

## 2026-08-06 — One outreach send per contact

- DB partial unique index on sent outreach per user+contact; send-outreach rejects duplicate sends with Gmail follow-up message.
- draft-emails skips contacts already sent; returns `skipped_already_sent`.
- Drafts list: checkmark + sent date; lock send/edit when outreach sent; Contacts kept tab shows sent state.

## 2026-08-06 — Profile-driven company discovery

- `company_discovery.ts`: skills/technologies → sector labels; recruiter-style queries; Crunchbase/Wellfound/LinkedIn/YC site searches; expanded listicle/finance host blocklist.
- Seed knowledge graph (CPU, AI accelerators, FPGA, EDA, quantum, embedded) merged before web results; depth sets web query budget (5/8/10).
- Listicle SERP titles: extract LinkedIn companies only — do not treat ranking pages as employers.

## 2026-08-07 — AI online company discovery

- Company discovery now feeds profile + filters (+ preference hints) to the AI and asks it to run live web searches (Serper/Bing via tool calls), then return real employers — not blogs/papers/listicles.
- People search at those companies prioritizes similar roles: filter include titles, outreach targets, and the user’s target roles.
- Removed template/sector query scraping + static knowledge-graph seeding from the hot path; job boards still supplement hiring signals.
- Going forward: redeploy touched Edge Functions after function changes (`npx supabase functions deploy <name> --project-ref czakwfzjkhsaysvqeswc`).

## 2026-08-07 — Orientation-guided UI

- Progressive unlock: Welcome → Profile → Filters → Search → Contacts → Drafts; sidebar greys out locked pages; Orientation progress bar until first draft.
- Profile: resume-first hero (“find direct contacts”), then fixed AI question series (location, employment type, remote, company size, seniority, industries, job titles) + Save profile.
- Filters simplified to Company targets / Contact targets with Continue during orientation; Overview renamed Search with run coaching.
- Contacts: discard locked until Keep one; handoff to Drafts to generate first draft and complete orientation.
- Defaults: Hunter and require verified emails off (client + edge + migration).

## 2026-08-07 — Orientation polish

- Chat asks exactly one scripted question per turn (ack only from model; no double questions).
- Profile load waits for resume lookup to avoid upload-hero flash.
- Settings: delete profile (confirm DELETE) wipes data and restarts orientation; verified-email checkbox strictly off by default.
- After first draft: optional Gmail connect popup + Copy draft button.

## 2026-08-07 — Pick-signal keep/discard learning

- Keep/discard chips: Not a person / Wrong industry / Not hiring-connected / Wrong location / Wrong job type; Keep: great location / hiring connection / industry / job type.
- Preference docs store feedback on the hiring signal + match reason that produced the contact (not person biographies).
- Filter rewrite + company discovery consume rewarded/rejected pick signals.

## 2026-08-07 — Contacts resume position

- Returning to Contacts restores the last pending contact under review (sessionStorage).
- After a search adds newer contacts, review starts on the most recent new pending card.

## 2026-08-07 — Go to drafts from Contacts

- After Draft email succeeds (or if a draft already exists), the button becomes “Go to drafts” and opens Drafts on that contact’s draft.

## 2026-08-07 — Drafts layout

- Collapsible email template strip at top; inbox list + current draft editor as the main workspace.

## 2026-08-07 — Marketing landing page

- Rebuilt `/` landing: dark forest-green system (Fraunces + Source Sans 3), sticky nav, hero contrast visual, problem / journey / product mockup / positioning sections, scroll reveals.
- Dedicated `landing.css` + `useReveal`; removed legacy minimal landing styles from `index.css`.

## 2026-08-07 — Profile chat UI polish

- Profile (`OnboardingPage`): coach avatar, welcome card, centered chat shell aligned with drafts/landing; intro explains updating search anytime; removed side “So far” panel.

## 2026-08-07 — Filters flow layout

- Company and contact targets side-by-side with 01→02 flow rail; AI learning (memo + pick signals) always shown below targets.

## 2026-08-07 — Settings and Search theme

- Settings: stacked cards for signature, job prefs, email discovery, Gmail, account.
- Search: flow rail, stat chips, run card, progress/report shells matching Filters styling.
