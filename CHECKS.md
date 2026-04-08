# What predeploy-audit checks (and why)

This file is the public per-check documentation. Each entry has:

- **What it catches** — the exact pattern
- **Why it matters** — the specific incident class it mirrors, with a link
- **Severity** — and how it can change based on context
- (Where relevant) tri-state outcomes and false-positive guarantees

The whole tool is intentionally narrow. Nine checks. Each one is here
because it has caused a real public incident in indie / vibe-coded apps.

---

## C1 — `.env*` files tracked in git

**Catches:** any of `.env`, `.env.local`, `.env.production`,
`.env.development.local`, `.env.staging`, `.env.test`, etc. that's
currently in `git ls-files`. Excludes templates: `.env.example`,
`.env.sample`, `.env.template`, `.env.dist`, `.env.schema`.

**Why it matters:** GitHub reported [over 39 million leaked secrets in
2024](https://snyk.io/articles/state-of-secrets/), a 67% YoY increase.
Toyota [exposed 270,000 customers](https://www.opsecforge.com/blog/env-files-destroy-companies)
via a five-year-old `.env` in a public repo. Average time from AWS key
commit to first exploitation: **under 2 minutes**.

**Severity:** 🟥 critical.

**False-positive surface:** approximately zero — exact basename matching
against an allowlist + an exclude list.

---

## C2 — `.env*` left in git history (after deletion from HEAD)

**Catches:** `.env*` files that *used to* be tracked but were removed.
The file is no longer in HEAD, but it lives forever in the git object
database.

**Why it matters:** Sharon Brizinov / Truffle Security's research on
GitHub ["oops commits"](https://www.infoq.com/news/2025/09/github-leaked-secrets/)
found thousands of secrets in force-pushed and deleted commits, including
an admin Personal Access Token over the Istio repos. **Removing a file
from HEAD does not remove it from history. Anyone who already cloned the
repo still has the secrets — rewriting history doesn't help them.**

**Severity:** 🟥 critical.

**Dedup with C1:** if a file is *currently* tracked (C1 is firing), C2
stays silent for that same file. C1 already covers the rotation
instructions.

**Caveat:** the scanner walks up to 10,000 commits. Larger histories
emit a "capped — run TruffleHog for deeper coverage" note.

---

## C3 — Hardcoded known-format secrets in tracked source

**Catches:** narrow prefix-format regexes for:

| Provider | Format |
|---|---|
| OpenAI | `sk-proj-…` (modern), `sk-…` (legacy) |
| Anthropic | `sk-ant-…` |
| Stripe | `sk_live_…` (live secret), `whsec_…` (webhook signing) |
| AWS | `AKIA…` (16 chars) |
| GitHub | `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` |
| Google | `AIza…` (35 chars) |

These are the formats most likely to ship in indie Next.js apps.
Detection is **prefix + length only** — no entropy heuristics, no broad
"looks like a secret" matching. False positives are vanishingly rare.

**Why it matters:** [Research at scale](https://www.ibtimes.com/api-key-leak-exposes-aws-stripe-openai-credentials-across-thousands-sites-3800355)
found **1,748 unique credentials** exposed across ~10K webpages spanning 14
providers. AI-generated and vibe-coded apps were
[disproportionately affected](https://securestartkit.com/blog/exposed-api-keys-how-ai-tools-leak-your-secrets-and-how-to-lock-them-down).

**Severity:** 🟥 critical.

**Excludes:**
- `.env.example` and other template files (filename allowlist)
- Lines containing placeholder substrings (`your-`, `REPLACE_ME`, `xxxxx`,
  `example`, `placeholder`, `dummy`, etc.)
- Test files under `__tests__/`, `test/`, `*.test.*`, `*.spec.*` — these
  are counted in the summary line but not raised as findings (so a
  fixture with a fake test key doesn't pollute your report)
- Top-level `README.md` and `EXPECTED_FINDINGS.md` (so the scanner doesn't
  flag itself)

**C3/C4 dedup:** if a secret appears on a `NEXT_PUBLIC_*` /
`VITE_*` / `REACT_APP_*` line in a `.env*` file, **C4 alone owns the
finding** — C3 stays silent for that same line. The user gets one
finding per mistake, with the correct fix instruction (rename + move
+ rotate).

---

## C4 — `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` variables containing secrets

**Catches:** any environment variable with a public/build-time prefix
where either:

- the **name** contains a secret indicator like `SECRET`, `PRIVATE`,
  `SERVICE_ROLE`, `API_KEY`, `WEBHOOK_SECRET`, `AUTH_SECRET`,
  `SIGNING_SECRET`, `PASSWORD`, `TOKEN`
- the **value** matches a C3 secret format

But NOT if the name contains `PUBLISHABLE`, `ANON`, `PUBLIC_KEY`,
`CLIENT_ID`, `URL`, `HOST`, `DOMAIN`, `ENDPOINT`, or `APP_ID` — those are
the canonical names for legitimately public config.

**Why it matters:** Modern frameworks bake `NEXT_PUBLIC_*` / `VITE_*` /
`REACT_APP_*` variables directly into the client JavaScript bundle at
build time. They are visible to anyone who opens DevTools. Recent
research found [84% of leaked API keys came from publicly accessible
JavaScript bundles](https://securestartkit.com/blog/exposed-api-keys-how-ai-tools-leak-your-secrets-and-how-to-lock-them-down)
— and AI coding assistants disproportionately produce this exact pattern.

**Severity:** 🟥 critical.

**This is the canonical vibe-coded mistake.** A developer wants their
frontend to call OpenAI, the AI assistant suggests prefixing the key
with `NEXT_PUBLIC_` "so the client can read it", and the key ships into
production embedded in the bundle.

---

## C5 — Supabase service-role key in client-reachable code

**Catches:** any reference to `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_SERVICE_KEY`, `SERVICE_ROLE_KEY`, or `serviceRoleKey` from a
file that the scanner classifies as **client-reachable**:

- File starts with an explicit `"use client"` directive, OR
- File is a Pages Router non-API page (`pages/**/*.{tsx,jsx}` excluding
  `pages/api/`)

**Why it matters:** Supabase's service-role key bypasses Row-Level
Security entirely. Embedding it in client code grants any visitor
unrestricted query and modify access to the entire database.
[ModernPentest's writeup](https://modernpentest.com/blog/supabase-security-misconfigurations)
calls service-role key exposure "the most critical vulnerability." The
[Supabase MCP / AI assistant prompt-injection thread](https://news.ycombinator.com/item?id=44502318)
demonstrates this pattern at scale in vibe-coded apps.

**Severity:** 🟥 critical.

**Tri-state outcomes** (this is one of the three checks where uncertainty
matters):

| File classification | Outcome |
|---|---|
| `"use server"` directive, route handler, middleware, `lib/server/`, `server/`, `scripts/` | Silent (safe) |
| `"use client"` directive, or `pages/**/*.{tsx,jsx}` non-API | 🟥 CRITICAL finding |
| Anything else (`components/**`, `lib/`, App Router pages without directive) | ⚠️ MANUAL CHECK item |

The strict classification rule (no implicit "components are client" assumptions)
exists because the cost of a false positive on a server-only helper is much
higher than the cost of asking the user to verify by hand.

**Anti-false-positive details:**
- Comments and string literals are stripped before identifier matching, so
  doc comments mentioning `SUPABASE_SERVICE_ROLE_KEY` don't fire the check.
- Only scans source code file extensions (`.ts`, `.tsx`, `.js`, `.jsx`,
  `.mjs`, `.cjs`, `.mts`, `.cts`) — `.env*` files are C1/C3/C4's job.

---

## C6 — Stripe webhook handler missing signature verification

**Catches:** route handlers under `app/**/api/stripe/**`, `app/**/webhook*/`,
`pages/api/**stripe**`, etc., that:

- Import the `stripe` package
- Read the raw request body via `request.text()`, `request.arrayBuffer()`,
  `req.rawBody`, or `req.body`
- Never call `stripe.webhooks.constructEvent(...)` (or the async variant)

**Why it matters:** This is exactly the pattern behind **CVE-2026-21894**,
the [n8n Stripe Trigger authentication bypass](https://www.gecko.security/blog/cve-2026-21894).
n8n stored the webhook secret but never used it to verify incoming
requests. Any unauthenticated HTTP client could forge a `checkout.session.completed`
event and trigger downstream upgrades, refunds, or subscription state
changes.

**Severity:** 🟥 critical.

**Tri-state outcomes:**

| State | Outcome |
|---|---|
| File matches the path gate, has stripe import, reads body, calls `constructEvent` | Silent (safe) |
| Same as above but verification is in a one-level-deep helper file the scanner can resolve | Silent (safe) |
| Same as above but verification is in a transitively-imported helper the scanner can't follow | ⚠️ MANUAL CHECK |
| Same as above but no `constructEvent` anywhere | 🟥 CRITICAL finding |

**Suppression:** add `// @predeploy-ignore: uses-webhook-wrapper` to the
file if you use a webhook helper library that does verification under
the hood.

---

## C7 — Supabase tables created without Row-Level Security

**Catches:** for every `CREATE TABLE public.<name>` in `supabase/migrations/**/*.sql`,
`supabase/seed.sql`, or top-level `schema.sql` / `database.sql`, look for
a corresponding `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY`
anywhere in the same migration set. If missing → finding. If
`DISABLE ROW LEVEL SECURITY` is present → finding.

**Why it matters:** **CVE-2025-48757** affected
[170+ Lovable-generated applications](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/)
in 2025. One of the leaks exposed 13,000 users via a missing RLS policy on
a password-reset-token table. Supabase's REST API auto-exposes every
public-schema table — and RLS is **opt-in, not default**. Vibe-coded apps
forget it constantly.

**Severity:** 🟥 critical.

**Tri-state outcomes:**

| State | Outcome |
|---|---|
| All `public.*` tables have matching `ENABLE ROW LEVEL SECURITY` | Silent (safe) |
| One or more tables missing the enable | 🟥 CRITICAL finding (one per table) |
| `DISABLE ROW LEVEL SECURITY` present | 🟥 CRITICAL finding |
| Migration files contain dollar-quoted blocks, `DO` blocks, or are >2000 lines | ⚠️ MANUAL CHECK ("could not fully parse") |
| `@supabase/supabase-js` installed but no migrations in repo | ⚠️ MANUAL CHECK ("schema visibility incomplete") |

The scanner is intentionally **conservative on uncertainty**. It would
rather emit a manual-check note than make a confident-looking false claim
about RLS coverage on tables it can't fully see.

---

## C8 — Vulnerable Next.js version (with hosting-platform aware severity)

**Catches:** the installed `next` version (resolved from `package-lock.json`,
`pnpm-lock.yaml`, `yarn.lock`, or `node_modules/next/package.json`) is in
the vulnerable range for either:

- **CVE-2025-29927** — middleware authorization bypass. Spoof the
  `x-middleware-subrequest` header to skip middleware entirely.
  [CVSS 9.1, EPSS 92.56](https://nvd.nist.gov/vuln/detail/CVE-2025-29927).
  Vulnerable: `<12.3.5`, `13.0.0–13.5.8`, `14.0.0–14.2.24`, `15.0.0–15.2.2`.
- **CVE-2024-34351** — Server Actions / Image SSRF.
  [Detail](https://www.miggo.io/vulnerability-database/cve/CVE-2024-34351).
  Vulnerable: `<14.1.1`.

**Why the hosting-platform framing matters:** [Vercel announced that
CVE-2025-29927 does not impact applications hosted on the Vercel platform](https://securitylabs.datadoghq.com/articles/nextjs-middleware-auth-bypass/).
Vercel auto-patches it. **Self-hosted apps on Railway, Fly.io, Docker,
Netlify, Render, etc. are NOT auto-patched.** This is the entire point
of the check: the same vulnerable version is LOW for a Vercel deployment
and CRITICAL for a Railway one.

**Severity:**

| Inferred host (from `vercel.json`, `fly.toml`, `railway.toml`, `Dockerfile`, etc.) | CVE-2025-29927 |
|---|---|
| Vercel | 🟦 LOW (auto-patched, defense-in-depth upgrade) |
| Fly.io / Railway / Docker / Netlify / Render | 🟥 CRITICAL |
| Unknown | 🟧 HIGH (both framings shown in the report body) |

CVE-2024-34351 is always 🟧 HIGH regardless of host (the SSRF surface is
in the application, not the platform).

---

## C9 — `remotePatterns` wildcard in `next.config.*`

**Catches:** any `hostname: "*"` or `hostname: "**"` (or `domains: ["*"]`)
in `next.config.js` / `.mjs` / `.ts` / `.cjs`. Comments are stripped
before matching. Specific hostnames like `images.unsplash.com` are NOT
flagged.

**Why it matters:** Wildcard `remotePatterns` lets the Next.js image
optimizer (`/_next/image?url=…`) proxy requests to **any** external host —
including internal networks and cloud metadata endpoints
(`169.254.169.254`). [Assetnote's Next.js SSRF research](https://www.assetnote.io/resources/research/digging-for-ssrf-in-nextjs-apps)
documents this pattern. CVE-2024-34351 was the application-side
manifestation.

**Severity:** 🟧 high.

**False-positive surface:** essentially zero — the wildcard pattern is
unambiguous.

**Suppression:** add `// @predeploy-ignore: behind-egress-firewall` if
you're confident your network blocks RFC1918 and cloud metadata.

---

## What predeploy-audit deliberately does NOT catch

These were considered during design and intentionally excluded from v1:

| Class | Why excluded |
|---|---|
| Generic SQL injection | Indie Next.js apps overwhelmingly use Supabase JS / Prisma / Drizzle / Kysely, all of which parameterize. Real prevalence is low; FP risk is high. |
| XXE | Modern Node + Next.js indie apps rarely parse XML at all. |
| Dynamic code-string execution APIs | Extremely rare in indie TypeScript; ESLint covers them. |
| HTTPS enforcement | Vercel / Railway / Fly auto-enforce HTTPS. Checking source doesn't prove production behavior. |
| Unsafe file upload | Usually handled by Uploadthing / Supabase Storage / presigned URLs / Vercel Blob. Too many correct implementations to detect deterministically. |
| Open redirect | Real class but low prevalence in indie Next.js apps; detection heuristic is noisy. |
| Weak password policy | Auth library domain. Clerk / Supabase Auth / Auth.js default well. |
| CSRF tokens | Next.js server actions have built-in CSRF handling. |
| Missing auth on every API route | Too false-positive-prone for v1 — see roadmap. |
| Rate limiting on auth endpoints | Not detectable from source alone. |
| Source maps in production | Next.js default is off; only a finding when explicitly enabled. Low prevalence. |
| Unsafe HTML rendering in JSX | Semgrep CE's React rules already cover it well. |
| Permissive CORS | Real class but origin-reflection detection requires AST analysis with high FP risk. |
| Public Supabase Storage buckets | Most are dashboard-configured (invisible from the repo). High false-negative rate would create false sense of safety. |

If you need any of these, run `semgrep`, `codeql`, or a real security
audit in addition to this tool. **predeploy-audit is deliberately
narrow.**
