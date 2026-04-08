---
name: predeploy-audit
description: "Fast pre-deploy security audit for indie Next.js + Supabase + Stripe apps. Catches the small set of mistakes most likely to burn solo developers shipping to Vercel, Railway, or Fly.io. Use when the user asks for a security check before deploying a hobby project, says something like 'is this safe to deploy', 'audit this for security', 'pre-deploy check', or 'check for common Next.js / Supabase / Stripe mistakes'. Runs in under 2 seconds, deterministic, trust-first."
allowed-tools:
  - Bash
  - Read
---

# predeploy-audit

A fast, high-trust security audit for hobby projects and vibe-coded apps —
the kind of thing a solo developer builds over a weekend and deploys to
Vercel, Railway, or Fly.io.

This skill is **not** a general-purpose scanner. It is a small, sharp set of
**9 deterministic checks** for the specific mistakes most likely to ship
in indie Next.js + Supabase + Stripe + AI-SDK apps:

1. Tracked `.env*` files in git
2. `.env*` in git history (after deletion)
3. Hardcoded known-format secrets (OpenAI, Stripe, Supabase, AWS, GitHub, Google)
4. `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` variables containing secrets
5. Supabase service-role key referenced from client-reachable code
6. Stripe webhook handlers missing signature verification
7. Supabase tables created without Row-Level Security
8. Vulnerable Next.js version (CVE-2025-29927, CVE-2024-34351), with
   hosting-platform aware severity framing
9. `remotePatterns` wildcard in `next.config.*` (SSRF surface)

## When to use this skill

**Use it when** the user is about to deploy a hobby Next.js project and wants
a quick security check, OR says any of:

- "audit this for security"
- "is this safe to deploy"
- "pre-deploy check"
- "check for common Next.js mistakes"
- "scan for leaked secrets"
- "predeploy audit" / "pre-deploy audit"
- "check before I push to Vercel" / "check before I deploy"

**Do NOT use it for:**

- Comprehensive enterprise security review (use semgrep, codeql, or a real
  pentest)
- Generic code quality (use linters)
- Vulnerability research
- Anything outside the 9 specific Next.js + Supabase + Stripe checks above

## How to invoke

The skill ships with a single Node.js scanner script. Run it against the
target repo:

```bash
node /Users/roxyproxy/.agents/skills/predeploy-audit/scanner/predeploy-audit.mjs <repo-path>
```

For deploy-gate mode (treats UNCERTAIN tri-state results as findings and
emits a `PREDEPLOY-AUDIT-RESULT: BLOCKED|CLEAN` sentinel line for CI):

```bash
node /Users/roxyproxy/.agents/skills/predeploy-audit/scanner/predeploy-audit.mjs <repo-path> --deploy-gate
```

If no path is given, the scanner audits the current working directory.

The scanner has **no runtime dependencies** — Node built-ins only. It calls
`git` via `execFileSync` (not the shell-using variant; arguments are passed
as a static array).

## How to interpret results

The report has four sections, in this fixed order:

1. **Framework-specific findings** (`OWN`) — the Next.js / Supabase /
   Stripe mistakes other tools won't catch. **Read these first.**
2. **Secret hygiene findings** (`PACKAGE`) — basic leaks (committed
   `.env`, hardcoded keys). Other tools can catch these too if installed.
3. **Manual-check items** — places where the scanner could not classify
   confidently. Each item explains exactly what to verify by hand.
4. **Clean / Not applicable** — checks that ran clean or didn't apply.

The summary line counts findings, manual-checks, and suppressed items
separately. The trailing `PREDEPLOY-AUDIT-RESULT: BLOCKED|CLEAN` line is
machine-grep-able for CI.

### Severity meanings

- **🟥 CRITICAL** — exploit possible by a drive-by attacker; full data or
  account compromise from one mistake
- **🟧 HIGH** — exploitable under reasonable conditions
- **🟦 LOW** — defense-in-depth only (e.g., CVE-2025-29927 against a
  Vercel-hosted app, where Vercel auto-patches)
- **⚠️  MANUAL CHECK** — uncertain; human review needed; not a finding

### Understanding tri-state outcomes

Three checks are designed with explicit tri-state (`finding` / `uncertain`
/ `clean`) handling because they require classifying ambiguous code:

- **C5** (Supabase service-role in client) — uncertain when the file lives
  under `lib/` or `components/` without a `"use server"`/`"use client"`
  directive
- **C6** (Stripe webhook verification) — uncertain when verification is in
  a transitively-imported helper the scanner can't follow
- **C7** (Supabase RLS missing) — uncertain when migrations contain
  dollar-quoted blocks or DO blocks that the scanner doesn't fully parse

In `normal` mode, uncertains appear as **manual-check items** and are
**not** counted as findings. In `--deploy-gate` mode they are escalated to
HIGH findings, because deploy gates need to fail closed.

## Suppressing a finding

If a finding is a false positive in your specific context, add an inline
comment:

```ts
// @predeploy-ignore: <short reason>
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
```

The scanner will treat that finding as "user-suppressed" and show it in
the summary line as such — it does not silently disappear.

## What this skill deliberately does NOT cover

These were considered during design and intentionally **excluded** from v1
because they have high false-positive risk or are well-covered by other
tools:

- Generic SQL injection (use a parameterized ORM; this is rare in
  Next.js + Supabase indie apps)
- XXE / XML parsing
- Dynamic code-string execution APIs (linters cover them)
- HTTPS enforcement (Vercel/Railway/Fly handle it)
- Unsafe file upload (too many correct implementations to detect)
- Open redirect
- CSRF tokens (Next.js server actions have built-in handling)
- Missing auth on every API route (too FP-prone for v1 — see v1.1 plan)
- Rate limiting (not detectable from source)
- Unsafe HTML rendering in JSX (Semgrep CE's React rules already cover it)
- Permissive CORS (would need origin-reflection AST analysis)

If you need any of these, use `semgrep`, `codeql`, or a real security tool
in addition to this one.

## Trust model

This skill is biased toward **trust over recall**. Specific design rules:

1. **Deterministic checks only.** No LLM judgment in the detection
   pipeline. The same input always produces the same output.
2. **Narrow regexes.** C3 secret detection uses prefix + length matching
   only — no entropy heuristics. False-positive budget is approximately
   zero.
3. **Comment + string-literal stripping** before C5 identifier matching,
   so doc comments mentioning `SUPABASE_SERVICE_ROLE_KEY` do not produce
   false positives.
4. **Strict file classification** for C5: `components/**` and `lib/**`
   without an explicit `"use client"` / `"use server"` directive are
   classified `ambiguous` — they produce manual-check items, never hard
   findings.
5. **Tri-state outcomes** wherever the scanner cannot classify with
   confidence (C5, C6, C7). The report distinguishes "finding" from
   "could not verify."
6. **Scanner only scans code file extensions** (`.ts/.tsx/.js/.jsx/.mjs/
   .cjs/.mts/.cts`) for C5 — `.env*` files belong to C1/C3/C4.

The scanner is designed to never produce a finding it can't defend.

## Regression target

The skill ships with `tests/run-tests.mjs`, a regression suite that runs
the scanner against:

- The wobblr demo vulnerable app (frozen contract: 7 critical · 1 high ·
  1 low · 1 manual-check)
- A clean baseline (must produce 0 findings)
- 5 edge-case fixtures: C2 history-only, C8 alternate host (Fly →
  CRITICAL), C3 test file Q1 path, C9 suppression-comment, no-git
  (C3 filesystem walker fallback)

Run it from anywhere with:

```bash
node /path/to/predeploy-audit/tests/run-tests.mjs
```

Expected output: `7 passed, 0 failed`. If any test fails, the scanner has
a regression — do not ship.

## File layout

```
predeploy-audit/                      (canonical published repo)
├── README.md
├── CHECKS.md
├── LICENSE
├── skill/
│   ├── SKILL.md                      (this file)
│   └── scanner/
│       └── predeploy-audit.mjs       (single Node ESM file, no deps)
├── tests/
│   ├── run-tests.mjs                 (regression runner)
│   └── fixtures/
│       ├── clean-baseline/           (must produce 0 findings)
│       ├── c2-history-only/          (.env removed in commit 2)
│       ├── c8-fly-host/              (Fly host → CVE-2025-29927 CRITICAL)
│       ├── c3-test-files/            (test-file Q1 suppression path)
│       ├── suppression-comment/      (inline @predeploy-ignore comment)
│       └── no-git/                   (C3 fs-walker fallback test)
└── demo-vulnerable-app/
    └── wobblr/                       (intentionally vulnerable demo)
```

The wobblr demo has its own `EXPECTED_FINDINGS.md` answer key that the
scanner is contractually bound to.
