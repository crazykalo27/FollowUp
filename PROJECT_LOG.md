# FollowUp — project log

Conceptual milestones (not a commit-by-commit diary).

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
