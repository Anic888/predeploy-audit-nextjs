# predeploy-audit

> A tiny, fast, low-noise deploy audit for vibe-coded Next.js apps.

You built something over a weekend. It works. You're about to push to
Vercel, Railway, or Fly.io. You're not a security engineer and you don't
want OWASP theory — you just want a quick check that you didn't ship the
small handful of mistakes that actually bite indie devs.

That's what this is.

```bash
node skill/scanner/predeploy-audit.mjs <path-to-your-app>
```

**~80 ms.** Zero dependencies. Deterministic. Designed to never produce a
finding it can't defend.

---

## What it catches

Nine specific mistakes, chosen because each one has caused real public
incidents in indie Next.js + Supabase + Stripe + AI-SDK apps. See
[CHECKS.md](./CHECKS.md) for evidence per check.

| # | Check | Severity |
|---|---|---|
| **C1** | `.env*` files tracked in git | 🟥 critical |
| **C2** | `.env*` left in git history (after deletion) | 🟥 critical |
| **C3** | Hardcoded OpenAI / Anthropic / Stripe / Supabase / AWS / GitHub / Google keys | 🟥 critical |
| **C4** | `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` variables containing secrets | 🟥 critical |
| **C5** | Supabase service-role key referenced from client-reachable code | 🟥 critical |
| **C6** | Stripe webhook handler missing `stripe.webhooks.constructEvent` (CVE-2026-21894 pattern) | 🟥 critical |
| **C7** | Supabase tables created without Row-Level Security (CVE-2025-48757 pattern) | 🟥 critical |
| **C8** | Vulnerable Next.js version against CVE-2025-29927 / CVE-2024-34351 — **with hosting-platform aware severity** (LOW on Vercel because Vercel auto-patches; CRITICAL on Railway / Fly.io / Docker because they don't) | 🟥 critical / 🟦 low |
| **C9** | `remotePatterns` wildcard `**` in `next.config.*` (CVE-2024-34351 SSRF surface) | 🟧 high |

That's the entire surface. **It doesn't try to be a general security
scanner. It tries to catch the things solo devs actually ship.**

---

## What it doesn't catch (and why)

The following are real classes of vulnerability that this tool **deliberately
does not check**, because they're either covered by existing tools, too
false-positive-prone for v1, or genuinely rare in indie Next.js apps:

- Generic SQL injection (use a parameterized ORM — rare in Supabase apps anyway)
- XXE / XML parsing
- Dynamic-code-string execution APIs (linters cover them)
- HTTPS enforcement (Vercel / Railway / Fly handle it)
- Unsafe file upload
- Open redirect
- CSRF tokens (Next.js server actions have built-in handling)
- Missing auth on every API route (too false-positive-prone — see roadmap)
- Rate limiting (not detectable from source)
- Unsafe HTML rendering in JSX (Semgrep CE's React rules cover it)
- Permissive CORS

If you need any of these, run `semgrep`, `codeql`, or a real security tool
in addition to this one. **This tool is deliberately small.**

---

## Try it on the demo (30 seconds)

The repo ships with `wobblr`, an intentionally vulnerable Next.js + Supabase
+ Stripe demo app. Every credential in it is a fake `DEMOFAKE…` placeholder.

```bash
git clone https://github.com/Anic888/predeploy-audit-nextjs.git
cd predeploy-audit-nextjs
node skill/scanner/predeploy-audit.mjs demo-vulnerable-app/wobblr
```

You'll see something like this:

```
# Pre-deploy security audit
Target: wobblr
Mode: normal
Ran 9 checks.

═══════════════════════════════════════════════════════
## Framework-specific findings
(The Next.js / Supabase / Stripe mistakes you were unlikely to catch otherwise.)
═══════════════════════════════════════════════════════

🟥 CRITICAL — C4: Client-exposed secret variable
   File: .env.local:14
   Variable: NEXT_PUBLIC_OPENAI_API_KEY
   Reason: name contains secret indicator; value matches OpenAI API key format
   Fix: Drop the public prefix (e.g. rename to OPENAI_API_KEY), move
        all usage to server actions or route handlers, and rotate the key.

🟥 CRITICAL — C5: Supabase service-role key in client-reachable code
   File: app/dashboard/page.tsx:17
   This file is classified as client-reachable (explicit "use client"
   directive or Pages Router page). The service-role key bypasses ALL
   Supabase Row-Level Security — visitors to your site can query or
   modify every row in your database.
   Fix: Move service-role usage into server-only code.

🟥 CRITICAL — C6: Stripe webhook handler missing signature verification
   File: app/api/stripe/webhook/route.ts
   Mirrors CVE-2026-21894.

🟥 CRITICAL — C7: Supabase table created without Row-Level Security
   File: supabase/migrations/20260101000000_init.sql:8
   Table: public.profiles
   Mirrors CVE-2025-48757.

🟧 HIGH — C9: Unrestricted image remote hostnames
   File: next.config.mjs:9

🟦 LOW — C8: Next.js 14.2.10 vulnerable to CVE-2025-29927 (Middleware authorization bypass)
   File: package.json
   Detected host: Vercel (via vercel.json).
   Vercel auto-patches this at the platform level — still recommended to upgrade.

═══════════════════════════════════════════════════════
## Secret hygiene findings
═══════════════════════════════════════════════════════

🟥 CRITICAL — C1: .env file tracked in git
   File: .env.local

🟥 CRITICAL — C3: Hardcoded Stripe live secret key in tracked source
   File: .env.local:21

🟥 CRITICAL — C3: Hardcoded Stripe webhook signing secret in tracked source
   File: .env.local:23

═══════════════════════════════════════════════════════
## Manual-check items
═══════════════════════════════════════════════════════

⚠️  C5: Could not verify safety of Supabase service-role reference
   File: lib/supabase-admin.ts
   What to check: confirm this file is only imported from server code...

═══════════════════════════════════════════════════════
## Summary
═══════════════════════════════════════════════════════

7 critical • 1 high • 1 low • 1 manual-check • 0 test-file matches • 0 user-suppressed

⚠️  DO NOT DEPLOY — 9 findings must be resolved.
PREDEPLOY-AUDIT-RESULT: BLOCKED
```

The full demo app is in [`demo-vulnerable-app/wobblr/`](./demo-vulnerable-app/wobblr/).
Its [`EXPECTED_FINDINGS.md`](./demo-vulnerable-app/wobblr/EXPECTED_FINDINGS.md)
is the frozen contract the scanner is tested against.

---

## Run on your own app

```bash
node /path/to/predeploy-audit/skill/scanner/predeploy-audit.mjs /path/to/your/app
```

Or, if you want CI to fail closed on uncertainties as well as findings:

```bash
node /path/to/predeploy-audit/skill/scanner/predeploy-audit.mjs /path/to/your/app --deploy-gate
# emits: PREDEPLOY-AUDIT-RESULT: BLOCKED|CLEAN
# exit 1 on findings or uncertain manual-checks; exit 0 if clean
```

The scanner needs Node.js (any version ≥18) and `git` on `PATH`. **No npm
install. No config file. No account.**

---

## Use as a Claude Code skill

If you're using [Claude Code](https://docs.claude.com/en/docs/claude-code),
you can install this as a skill that triggers when you ask Claude to do a
pre-deploy audit:

```bash
ln -s /path/to/predeploy-audit/skill ~/.agents/skills/predeploy-audit
```

Then in any Claude Code session, ask: *"audit this for security before I
deploy"* or *"is this safe to deploy"* or *"run a pre-deploy check"*. The
skill takes over and runs the scanner.

The skill front door is in [`skill/SKILL.md`](./skill/SKILL.md).

---

## Why a tool when Vercel already has secret scanning?

Vercel's [secret scanner](https://vercel.com/changelog/new-token-formats-and-secret-scanning)
is good at one specific thing: detecting Vercel's own tokens (`vcp_`, `vci_`,
`vca_`, `vcr_`, `vck_`) that get pushed to public GitHub. It's narrower
than most people think — it doesn't audit your source for OpenAI / Stripe /
Supabase / AWS keys, it doesn't know about Next.js client/server boundaries,
it doesn't verify Supabase RLS, and **none of it runs on Railway / Fly.io /
self-hosted Docker at all**.

`gitleaks` and `TruffleHog` are good at finding raw secret strings in your
git tree, but they don't know about `NEXT_PUBLIC_` semantics, Stripe webhook
verification patterns, or your `next.config.js`.

`semgrep` and `codeql` can in principle catch some of this with the right
ruleset — but they require install, configuration, and they have no Next.js
directory in CE.

This tool is the one a solo developer can actually run in 80 milliseconds
with zero setup, and trust the result of, before they push to production.

---

## Trust model

This tool is biased toward **trust over recall**. Specific design rules:

1. **Deterministic checks only.** No LLM judgment in the detection
   pipeline. Same input → same output, byte for byte.
2. **Narrow regexes.** Secret detection uses prefix + length matching only —
   no entropy heuristics. False-positive budget is approximately zero.
3. **Comment + string-literal stripping** before identifier matching, so a
   doc comment that *mentions* `SUPABASE_SERVICE_ROLE_KEY` doesn't produce
   a false positive.
4. **Strict file classification.** `components/**` and `lib/**` without an
   explicit `"use client"` / `"use server"` directive are classified as
   *ambiguous* — they produce manual-check items, **never hard findings**.
5. **Tri-state outcomes** wherever the scanner can't classify with full
   confidence (C5, C6, C7). The report distinguishes "finding" from "could
   not verify" so you can tell what's a real bug from what needs a 30-second
   human glance.
6. **Hosting-platform aware severity.** CVE-2025-29927 is LOW on Vercel
   (Vercel auto-patches) and CRITICAL on Railway / Fly.io / Docker. The
   scanner detects which host you're targeting and frames the same vuln
   correctly for each one.

---

## Tested against a frozen demo + 6 edge-case fixtures

Every change to the scanner runs against:

- **`wobblr`** — the demo vulnerable app, with a frozen contract of
  exactly 7 critical · 1 high · 1 low · 1 manual-check
- **`clean-baseline`** — a normal Next.js app that must produce **zero
  findings** (the anti-false-positive test)
- **`c2-history-only`** — `.env` removed in commit 2; C2 fires, C1 doesn't
- **`c8-fly-host`** — same vulnerable Next.js as wobblr but on Fly.io;
  C8 escalates from LOW to CRITICAL
- **`c3-test-files`** — secrets inside `__tests__/` are suppressed but
  counted in the summary
- **`suppression-comment`** — `// @predeploy-ignore: <reason>` correctly
  silences a real finding and surfaces it as user-suppressed
- **`no-git`** — verifies the C3 filesystem-walker fallback when the
  target directory is not a git repository

The runner copies each fixture to a temporary workspace and (where
needed) initializes git on the fly, so the suite is reproducible from
a fresh `git clone` with no setup steps:

```bash
node tests/run-tests.mjs
# 7 passed, 0 failed
```

If you submit a PR that breaks the regression suite, it doesn't merge.

---

## Suppressing a finding

If a finding is a false positive in your specific context, add an inline
comment:

```ts
// @predeploy-ignore: server-only-wrapper
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
```

The scanner treats it as "user-suppressed" and shows it in the summary
line as such — it does not silently disappear.

---

## Roadmap

v1 deliberately ships nine checks. Things considered for v1.1:

- C2 wraps gitleaks/TruffleHog under-the-hood for deeper history coverage
- Missing-auth on Next.js API routes / Server Actions (needs careful
  AST analysis to avoid false positives)
- Rate-limiting detection on auth-sensitive endpoints
- `productionBrowserSourceMaps: true` detection
- Session cookie flag detection for hand-rolled `Set-Cookie` headers
- JSON output mode for CI integration

These are not in v1 because the bar is "I can defend every finding the
tool produces." If a check can't clear that bar, it doesn't ship.

---

## License

MIT — see [`LICENSE`](./LICENSE).
