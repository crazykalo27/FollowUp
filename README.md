## FollowUp — marketing summary

**Tagline:** Skip the application black hole. Reach the people who actually hire.

---

### Vision

FollowUp is for job seekers who are tired of portals that go nowhere. Instead of spraying applications into the void, you build a sharp search profile, discover real employers and the right people inside them, and send thoughtful outreach from **your own Gmail**—resume attached, on your terms. The product favors **hiring managers and peers in similar roles**, not generic recruiter inboxes.

---

### Who it’s for

Anyone with a resume and a target direction—roles, industries, locations, remote preferences—who wants a **direct, human path** to conversations, not another “Applied” checkbox.

---

### Look & feel

A focused **dark, forest-green** workspace: soft off-white text, **lime accent** CTAs, **Fraunces** for headlines and **Source Sans** for UI copy. The landing page is atmospheric and minimal; inside the app, a **sidebar** keeps you oriented: Profile → Filters → Search → Contacts → Drafts → Settings. Clean, calm, job-hunt serious—not a noisy dashboard.

---

### First-run orientation

FollowUp **teaches itself in order**. A progress bar walks you from welcome through your first draft:

1. **Welcome** — name and optional links for real email signatures
2. **Profile** — resume upload, then a short AI interview (location, employment type, seniority, industries, titles)
3. **Filters** — company and contact targets, refined with AI from your profile and feedback
4. **Search** — run a people search with live progress
5. **Contacts** — keep at least one contact (swipe-style review)
6. **Drafts** — generate your first outreach draft

Until you finish, later steps stay **locked** in the nav so you’re never dropped into an empty screen. After the first draft, the full app unlocks—including optional Gmail connect and copy/send flows.

---

### Core features (MVP)

| Area         | What you get                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile**  | Resume parsing + AI chat that turns your background into searchable targets                                                                   |
| **Filters**  | Include/exclude titles, company vs. contact targets; preferences learn from what you keep or discard                                          |
| **Search**   | AI-driven employer discovery on the open web, then people at those companies; Quick / Standard / Deep depth; live stage bars and activity log |
| **Contacts** | One-card review (keep/discard), feedback chips that train future picks, kept/archive/sent states                                              |
| **Drafts**   | LLM outreach per contact, templates with placeholders, regenerate, one send per contact (duplicate protection)                                |
| **Settings** | Signature fields, optional Hunter.io and verified-email toggles, Gmail OAuth for send, delete-account reset                                   |

**Under the hood (user-facing outcome):** Google sign-in, resume in secure storage, email discovery via optional Hunter or a **free OSINT path** (site crawl, patterns, MX checks), job boards as **hiring signals**—not the whole story. **No LinkedIn scraping**; public URLs via search APIs. Sends go through **Gmail API** from the user’s account, not a bulk mailer.

---

### MVP scope (what “shipped” means)

This is a **real end-to-end loop**, not a demo: static web app on GitHub Pages + Supabase (auth, database, edge functions). One user can go from **sign-in → profile → search → review → draft → send** without leaving the product narrative. Post-MVP polish includes preference learning from keep/discard signals, resuming contact review where you left off, and “Go to drafts” after drafting from Contacts.

---

### Positioning in one line

**FollowUp is an AI-guided outreach co-pilot for job seekers:** it finds the right companies and people, drafts the email, and lets you send like yourself—from Gmail—with a resume and a strategy, not a spam blast.

---

If you want this tightened for a landing page hero, a pitch deck slide, or App Store–style bullets, say which format and audience (investors vs. users).
