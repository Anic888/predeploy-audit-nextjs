# wobblr — expected scanner findings (frozen answer key)

> ⚠️ **wobblr is an intentionally vulnerable demo app. Every credential
> in `.env.local` is a `DEMOFAKE…`-marked placeholder. Nothing in this
> repo is a real key.**

This file is the regression target for the **predeploy-audit** Claude
Code skill. When the skill runs against this repo in `normal` mode,
it must produce **exactly the counts and findings frozen below** —
no more, no less. Any deviation is a bug in the skill (false
positive or false negative) and blocks Phase 4 from being marked
done.

---

## Frozen counts

> **Phase 4 amendment (Apr 2026):** the original Phase 3 freeze was 6 CRIT
> / 8 total. Phase 4 implementation surfaced one legitimate C3 finding I
> missed during the freeze: the `whsec_DEMOFAKE…` Stripe webhook signing
> secret on `.env.local:23`. It is a real `whsec_`-format secret in a
> tracked file and the scanner correctly catches it. Suppressing it to
> preserve the original count would have been "softening standards
> during implementation" — the exact failure mode the Phase 4 rules
> forbid. Counts below are the corrected post-amendment values.
> See V2b below.

| Outcome class | Frozen count |
|---|---|
| 🟥 CRITICAL findings | **7** |
| 🟧 HIGH findings | **1** |
| 🟦 LOW findings | **1** |
| ⚠️ Manual-check items (UNCERTAIN tri-state) | **1** |
| ➖ Not applicable / clean checks | **1** |
| Total findings (CRITICAL + HIGH + LOW) | **9** |

The "test-file C3 matches" line in the summary should read **0**
(this demo deliberately contains no test files — see "Why no test
files" section below).

The "skipped by user" line should read **0** (this demo deliberately
uses no `// @predeploy-ignore:` suppression comments — that path is
tested in Phase 4 via a dedicated fixture, not here).

---

## V1–V8 — the 8 baked-in findings

Each row below is **one expected finding**, mapped to one Core
check. The scanner must produce exactly these and nothing else
that isn't in the manual-check section.

### V1 — C1 — `.env.local` tracked in git

- **Severity:** 🟥 CRITICAL
- **File:** `.env.local`
- **What's wrong:** `.env.local` is committed to the repo. The
  `.gitignore` deliberately omits it. Mirrors the most common indie
  leak pattern.
- **Why it fires:** `git ls-files` returns `.env.local`; the basename
  is in C1's include list and not in the `.env.example`/`.env.sample`
  exclude list.
- **Section:** Secret hygiene findings.

### V2 — C3 — Hardcoded Stripe live key in tracked source

- **Severity:** 🟥 CRITICAL
- **File:** `.env.local:21` (`STRIPE_SECRET_KEY=sk_live_DEMOFAKE…`)
- **What's wrong:** A `sk_live_`-prefixed Stripe secret format
  appears in a tracked file. Even though it's a fake placeholder,
  the *shape* matches C3's narrow detector and the scanner must
  treat it as a finding.
- **Why it fires:** C3's regex matches `sk_live_` + length, file is
  tracked, basename is not on the test-file or `.env.example`
  exclude list, line does not contain a placeholder substring like
  `your-`/`xxxxx`/`replace_me` (we deliberately used `DEMOFAKE…`,
  which the scanner does not treat as a placeholder, so the regex
  stays alive). The variable name `STRIPE_SECRET_KEY` is NOT
  prefixed `NEXT_PUBLIC_*`, so the C3/C4 dedup rule does not
  suppress it.
- **Section:** Secret hygiene findings.

### V2b — C3 — Hardcoded Stripe webhook signing secret in tracked source (Phase 4 amendment)

- **Severity:** 🟥 CRITICAL
- **File:** `.env.local:23` (`STRIPE_WEBHOOK_SECRET=whsec_DEMOFAKE…`)
- **What's wrong:** A `whsec_`-prefixed Stripe webhook signing
  secret in a tracked file. Same root cause as V2, different key.
- **Why it fires:** Identical to V2's mechanism but the matched
  format is `whsec_` instead of `sk_live_`. The variable name
  `STRIPE_WEBHOOK_SECRET` is also not `NEXT_PUBLIC_*` prefixed, so
  C3/C4 dedup does not suppress it.
- **Section:** Secret hygiene findings.
- **Why this was added in Phase 4:** I missed it during the Phase 3
  freeze. The scanner correctly catches it. Per the "trust over
  recall" rule (and the explicit Phase 4 prohibition on softening
  standards), the right action is to amend the contract upward, not
  to suppress the true positive.

### V2/V2b vs V3 distinction

V2 and V2b are *value* findings — the secrets `sk_live_…` and
`whsec_…` are intrinsically dangerous regardless of variable name.
V3 is a *variable-name + prefix* finding — `NEXT_PUBLIC_OPENAI_API_KEY`
is dangerous because the prefix exposes it to clients, regardless of
value. The same `.env.local` file produces V1 once (file existence),
V2 + V2b twice (two server-format secrets needing rotation), and
V3 once (one client-prefixed variable). Four findings, four distinct
fix instructions, no duplication.

The C3/C4 dedup rule prevents the OpenAI key on `.env.local:14` from
firing C3 *as well as* C4 — because the line is `NEXT_PUBLIC_*`-prefixed,
C4 alone owns it. The Stripe lines are not `NEXT_PUBLIC_*`-prefixed,
so C3 alone owns them.

### V3 — C4 — `NEXT_PUBLIC_OPENAI_API_KEY` exposed in client bundle

- **Severity:** 🟥 CRITICAL
- **File:** `.env.local` (variable definition); `lib/openai.ts`
  (referenced) — wait, in this repo the OpenAI key is referenced from
  `app/api/ai/describe/route.ts` (which uses the **non-prefixed**
  `OPENAI_API_KEY` correctly). The `NEXT_PUBLIC_OPENAI_API_KEY`
  variable is defined in `.env.local` but **not actively used in
  source** in this version of the demo, because we want the C4
  finding to fire purely on the env-file source path (Source A in
  the C4 design), without confusing the report with a Source B
  cross-reference.
- **What's wrong:** A variable named with the `NEXT_PUBLIC_` prefix
  contains a value matching the OpenAI `sk-proj-…` format. Any
  variable so prefixed is embedded into the client JavaScript bundle
  at build time and visible to anyone who opens DevTools.
- **Why it fires:** C4's two-heuristic check passes both:
    - Name heuristic: `NEXT_PUBLIC_OPENAI_API_KEY` contains
      `OPENAI_API_KEY` (treated as a watched name) and is not on
      the allowlist (`ANON`, `PUBLISHABLE`, `URL`, etc.)
    - Value heuristic: value matches the OpenAI `sk-proj-…` prefix
      format from C3's curated set
- **Section:** Framework-specific findings.

### V4 — C5 — Service-role key in `"use client"` component

- **Severity:** 🟥 CRITICAL (hard finding, not tri-state)
- **File:** `app/dashboard/page.tsx`
- **What's wrong:** File starts with `"use client"` and references
  `process.env.SUPABASE_SERVICE_ROLE_KEY`. The service-role key
  bypasses RLS and is now embedded in the client bundle.
- **Why it fires:** §2.1.1 classification rules: explicit
  `"use client"` directive on the first line → **client-reachable**.
  C5 detection step 1 grep matches `SUPABASE_SERVICE_ROLE_KEY` in
  this file. Combination → hard CRITICAL finding (not the
  manual-check tri-state outcome).
- **Section:** Framework-specific findings.

### V5 — C6 — Stripe webhook missing signature verification

- **Severity:** 🟥 CRITICAL (hard finding, not tri-state)
- **File:** `app/api/stripe/webhook/route.ts`
- **What's wrong:** File matches the C6 file-path gate
  (`app/**/api/stripe/**/route.ts`), imports `stripe`, reads the
  raw body via `await request.text()`, but never calls
  `stripe.webhooks.constructEvent(...)`. Mirrors CVE-2026-21894.
- **Why it fires:** All three C6 step-1 conditions are met
  (file path, stripe import, raw-body read). Step 2 verification
  search returns zero `constructEvent*` matches in the file → hard
  CRITICAL.
- **Section:** Framework-specific findings.

### V6 — C7 — Supabase table `public.profiles` created without RLS

- **Severity:** 🟥 CRITICAL (hard finding, not tri-state)
- **File:** `supabase/migrations/20260101000000_init.sql`
- **What's wrong:** `CREATE TABLE public.profiles (…)` exists but
  no `ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY`
  appears anywhere in any migration file in `supabase/migrations/`.
  Mirrors CVE-2025-48757.
- **Why it fires:** C7 step 1 detects `@supabase/supabase-js` in
  package.json. Step 2 finds the migration file. Step 3's regex
  matches the `CREATE TABLE` for `public.profiles`. Step 4
  cross-reference finds zero matching `ENABLE RLS` for that table.
  Step 5 uncertainty check: the migration file is short, no
  dollar-quoted blocks, no functions → parse confidence is high
  → hard CRITICAL (not the UNCERTAIN tri-state outcome).
- **Section:** Framework-specific findings.

### V7 — C8 — Next.js 14.2.10 vulnerable to CVE-2025-29927

- **Severity:** 🟦 LOW (because `vercel.json` → host inferred as
  Vercel → Vercel auto-patches CVE-2025-29927)
- **File:** `package.json` + `package-lock.json`
- **What's wrong:** Installed Next.js version is 14.2.10, which is
  below the 14.2.25 fix for CVE-2025-29927. CVE-2024-34351 (fixed
  in 14.1.1) does NOT apply here because 14.2.10 > 14.1.1, so the
  scanner must NOT emit a separate CVE-2024-34351 finding. This
  tests that C8 correctly handles multi-CVE matrix logic.
- **Why it fires:** C8 step 1 reads `next` from package.json and
  resolves to 14.2.10 from package-lock.json. Step 2 compares
  against the CVE-2025-29927 vulnerable ranges (matches the
  14.x range). Step 3 host inference: `vercel.json` exists at
  repo root → host = Vercel. Step 4 framing matrix: Vercel +
  CVE-2025-29927 = LOW.
- **Section:** Framework-specific findings (in the LOW band).

### V8 — C9 — `remotePatterns` wildcard in `next.config.mjs`

- **Severity:** 🟧 HIGH
- **File:** `next.config.mjs`
- **What's wrong:** `remotePatterns: [{ protocol: 'https', hostname: '**' }]`
  allows the Next.js image optimizer to proxy requests to any host,
  including internal networks. Mirrors the SSRF surface from
  CVE-2024-34351's underlying configuration class.
- **Why it fires:** C9 step 4 regex matches `hostname:\s*["']\*\*["']`
  in the config file.
- **Section:** Framework-specific findings.

---

## Manual-check item (the 1 UNCERTAIN)

### M1 — C5 — `lib/supabase-admin.ts` (tri-state ambiguous)

- **Severity:** ⚠️ MANUAL CHECK (not counted as a finding)
- **File:** `lib/supabase-admin.ts`
- **What it looks like:** References `SUPABASE_SERVICE_ROLE_KEY`,
  no `"use server"` / `"use client"` / `"server-only"` directive,
  lives under `lib/` with no path-based override.
- **Why this is the right outcome:** Per Phase 2 §2.1.1 (revised
  by Q2), `lib/**` without a directive is **ambiguous**. C5's
  detection grep matches the watched pattern. Tri-state outcome:
  emit a MANUAL-CHECK item, NOT a hard finding.
- **What the scanner output should say:** "Could not verify
  whether this file is server-only. Confirm it is only imported
  from server code, then add `// @predeploy-ignore: server-only-wrapper`."
- **Why it's a decoy and a finding at the same time:** This is
  the demo's most important regression test. If the scanner emits
  a CRITICAL here, the Q2 strict classification is broken. If it
  emits nothing at all, the C5 grep step is broken. Only the
  UNCERTAIN outcome is correct.

---

## D1–D9 — decoys the scanner MUST NOT flag

These are negative controls. Any output mentioning these files
(other than D7 above) is a false positive and a Phase 4 blocker.

| ID | File | What it tests | Must not trigger |
|---|---|---|---|
| D1 | `.env.example` | C1 filename allowlist + C3 placeholder substring exclusion. Also: this file contains the literal string `SUPABASE_SERVICE_ROLE_KEY` as a template variable name. **C5 must only scan source files (`.{ts,tsx,js,jsx,mjs,cjs}`), NOT `.env*` files.** If Phase 4 scans `.env*` for C5, this file becomes a false positive. The `.env*` files are C4's responsibility. | C1, C3, **C5** |
| D2 | `components/BillingBanner.tsx` | C4 name allowlist (`PUBLISHABLE`); `pk_live_` value format must not match C3 (C3 only matches `sk_live_`, not `pk_live_`) | C3, C4 |
| D3 | `app/u/[username]/page.tsx` | Server component (no directive, RSC default) using anon key only. **TRAP:** the file contains the literal substring `SERVICE_ROLE` inside a doc comment ("the scanner must NOT flag this file for C5 (no SERVICE_ROLE reference)"). A naive C5 implementation that greps the raw file source for `SERVICE_ROLE` will false-positive here. **Per Phase 2 §C5 anti-FP, matches inside comments must be excluded.** This decoy enforces that requirement. | C4, **C5 (comment-strip enforcement)** |
| D4 | `app/api/ai/describe/route.ts` | Route handler under `app/**/route.ts` → server-only classification; uses non-prefixed `OPENAI_API_KEY`; no literal key string | C3, C4 |
| D5 | `lib/stripe-helpers.ts` | Stripe import + body verification helper, but file path is NOT under the C6 webhook file-path gate so the gate excludes it before any other check runs | C6 |
| D6 | `components/UserBio.tsx` | `components/**` without directive → ambiguous classification. **TRAP:** like D3, this file contains the literal substring `SUPABASE_SERVICE_ROLE_KEY` inside a doc comment explaining why it should NOT match. A naive C5 grep would false-positive here. The comment-strip rule must apply. | **C5 (comment-strip enforcement)** |
| D7 | `lib/supabase-admin.ts` | **THIS IS THE MANUAL-CHECK ABOVE.** Listed here for completeness so the decoy table is exhaustive. The reference here is in **executable code**, not a comment, so the comment-strip rule does NOT exclude it — C5 must still emit an UNCERTAIN. | (UNCERTAIN, not finding) |
| D8 | `next.config.mjs` (the `images.remotePatterns` line) | C9 must flag the wildcard once but must NOT also produce duplicate matches for the same line | (no duplicates) |
| D9 | `.env.example`'s `pk_test_REPLACE_ME` line | C3 placeholder substring (`REPLACE_ME`) and `.env.example` filename both exclude this match | C3 |

---

## Phase 2 design clarifications surfaced by Phase 3

Building wobblr surfaced two §C5 design details that were under-specified
in the Phase 2 report. They are tightened here and Phase 4 must implement
them this way:

1. **C5 only scans source files.** C5's grep step must restrict to
   `*.{ts,tsx,js,jsx,mjs,cjs}` (and ideally `.mts`/`.cts`). It must NOT
   scan `.env*` files, README files, JSON, or anything else. The
   variable-name string `SUPABASE_SERVICE_ROLE_KEY` legitimately
   appears as a key in `.env.example` (it's the *name* of the var, not
   a usage); flagging that as a C5 client-reachable reference would be
   nonsense. `.env*` files belong to C1/C3/C4, not C5.

2. **C5 must strip comments and string literals before matching.** Phase 2
   §C5 anti-FP already says "matches inside string literals, comments,
   and JSDoc excluded" — Phase 3 confirms this is load-bearing for the
   D3 and D6 decoys. Phase 4 implementations that skip this step will
   fail those decoys.

These are Phase 2 amendments, not new checks. Both sit inside C5's
existing design surface.

---

## What's deliberately NOT covered by this demo

These coverage gaps are **intentional** and will be tested by
separate Phase 4 fixture repos, not by adding noise to wobblr:

- **C2 (`.env` in git history)** — wobblr's `.env.local` is in
  HEAD (V1), and per the C2 design step 3 dedup rule, C2 stays
  silent when C1 already fires for the same file. Phase 4 ships
  a separate single-commit fixture that has `.env` only in
  history.
- **C8 alternate host framings** — wobblr is Vercel-hosted (V7
  is LOW). The CRITICAL framing for self-hosted hosts (Railway,
  Fly.io, Docker) is tested by a separate Phase 4 fixture with
  `fly.toml` instead of `vercel.json`.
- **Test file handling for C3 (Q1 decision)** — wobblr has no
  test files. The "test-file matches" summary count must read
  **0** when the scanner runs against wobblr. The test-file
  exclusion path is tested in a separate Phase 4 fixture.
- **Suppression comments (`// @predeploy-ignore:`)** — wobblr
  uses none. The suppression path is tested in a separate Phase 4
  fixture.
- **Unsupported lockfile formats (bun.lockb)** — wobblr uses
  npm. The bun fallback path is tested in a separate Phase 4
  fixture.

---

## Frozen expected output (top-level shape, Phase 4 amended)

```
7 critical • 1 high • 1 low • 1 manual-check • 0 test-file matches • 0 user-suppressed

⚠️  DO NOT DEPLOY — 9 findings must be resolved.
PREDEPLOY-AUDIT-RESULT: BLOCKED
```

If the Phase 4 skill produces anything other than these counts when
run against this exact commit of wobblr, that is a regression.
