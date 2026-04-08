# Launch copy

Drafts for Twitter / X, Hacker News (Show HN), and indie / Vercel community
posts. **Pick one, edit for voice, ship.** None of these are sent yet.

The positioning is the same across all of them:

> A tiny, fast, low-noise deploy audit for vibe-coded Next.js apps.

Not "AI security." Not "the new OWASP scanner." Not "enterprise-grade."
The hook is: indie devs are about to deploy, they're not security
engineers, and there's a small set of mistakes that will actually burn
them. This catches those.

---

## Twitter / X — primary thread (4 tweets)

**1/**

I built a tiny pre-deploy security scanner for indie Next.js apps.

9 checks. ~80ms. No config. Catches the small set of mistakes that
actually burn solo devs:

— `NEXT_PUBLIC_OPENAI_API_KEY` (the canonical vibe-code bug)
— Supabase RLS missing
— Stripe webhook signature missing
— Next.js auth bypass CVE
— `.env` in git
— more

https://github.com/Anic888/predeploy-audit-nextjs

**2/**

Why a tool when GitHub already scans for secrets?

GitHub catches *known-format* keys after you push. It doesn't know your
`SUPABASE_SERVICE_ROLE_KEY` is being read from a `"use client"`
component. It doesn't check Stripe webhook signature verification.
It doesn't audit your `next.config.js`.

**3/**

The CVE-2025-29927 Next.js middleware auth bypass (CVSS 9.1, March
2025) is fixed in 14.2.25 / 15.2.3. Vercel auto-patches their hosted
deployments. Railway / Fly.io / Docker do NOT.

This tool detects which host you're targeting and frames the same
vuln correctly: LOW for Vercel, CRITICAL for self-hosted. That's the
whole point.

**4/**

Trust matters more than recall. The scanner ships with a 7-fixture
regression suite (including a deliberately vulnerable demo app and a
clean baseline). Any change that breaks `7 passed, 0 failed` is rejected.

MIT. Single Node file. No npm install.

https://github.com/Anic888/predeploy-audit-nextjs

---

## Twitter / X — alt single tweet (if the thread feels too long)

A pre-deploy security check for vibe-coded Next.js apps:

```
node predeploy-audit.mjs ./my-app
```

9 checks, ~80ms, no config. Catches `NEXT_PUBLIC_*` secret leaks,
missing Supabase RLS, Stripe webhook bypass, Next.js auth-bypass CVEs,
`.env` in git. Nothing else.

Trust > recall. MIT. [link]

---

## Hacker News — Show HN

**Title (under 80 chars):**

Show HN: Predeploy-audit – a 9-check security scan for vibe-coded Next.js apps

**Post body:**

I built this because every time I'm about to push a hobby project to
Vercel or Railway I wanted a 30-second sanity check, and the existing
options were either too narrow (gitleaks/TruffleHog only catch raw
secret strings), too heavy (Semgrep/CodeQL want install + ruleset
config), or too commercial (vibeappscanner is $29/mo and black-box).

The goal was small and trust-first. 9 checks. Not 90. Each check is in
the tool because it has caused a real public incident in indie /
vibe-coded apps:

- **C1/C2** — `.env*` tracked or in git history (Toyota leaked 270K
  customers via a 5-year-old `.env`; GitHub saw 39M+ leaked secrets in 2024)
- **C3** — Hardcoded OpenAI / Anthropic / Stripe / Supabase / AWS /
  GitHub / Google keys in source (1,748 unique credentials found across
  ~10K webpages in one research scan)
- **C4** — `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` variables holding
  secrets (the canonical vibe-coded mistake — 84% of leaked keys came
  from publicly accessible JavaScript bundles)
- **C5** — Supabase service-role key referenced from `"use client"`
  components (the AI assistant prompt-injection failure mode)
- **C6** — Stripe webhook handlers missing `stripe.webhooks.constructEvent`
  — directly mirrors CVE-2026-21894 (n8n)
- **C7** — Supabase tables created without RLS — directly mirrors
  CVE-2025-48757 (170+ Lovable apps exposed; 13K users leaked from one app)
- **C8** — Vulnerable Next.js version against CVE-2025-29927 (CVSS 9.1
  middleware auth bypass) and CVE-2024-34351, **with hosting-platform
  aware severity** — Vercel auto-patches CVE-2025-29927 so it's LOW for
  Vercel-hosted apps but CRITICAL for Railway / Fly.io / Docker
- **C9** — `remotePatterns: "**"` wildcard in `next.config.*` (SSRF
  surface from CVE-2024-34351's underlying class)

Implementation:

- Single ~2000 LoC Node ESM file. Zero runtime deps. Node 18+ and `git`.
- ~80ms on a typical hobby app
- Deterministic — same input, same output, byte for byte
- Three of the checks (C5, C6, C7) are explicitly tri-state. They emit
  "manual-check" items when the scanner can't classify with full
  confidence, so it never fakes certainty
- Suppression via inline `// @predeploy-ignore: <reason>` comments;
  suppressed findings are still surfaced in the summary, never silently
  hidden

Trust model:

- Comments and string literals are stripped before identifier matching
  (so a doc comment mentioning `SUPABASE_SERVICE_ROLE_KEY` doesn't fire)
- Narrow regexes only — no entropy heuristics
- Strict file classification: `components/**` and `lib/**` without an
  explicit `"use client"` / `"use server"` directive are *ambiguous*,
  not assumed client. They emit manual-check items, never hard findings.

What it deliberately does NOT do:

- Generic SQL injection, XXE, dynamic code execution, HTTPS, file upload,
  open redirect, weak passwords, CSRF, missing route auth, rate limiting,
  unsafe HTML rendering in JSX, permissive CORS, public Storage buckets
- Each of these is documented in CHECKS.md with the reason it was
  excluded from v1 (mostly: too false-positive-prone, well-covered by
  other tools, or genuinely rare in indie Next.js)

The repo ships with a deliberately vulnerable demo app called `wobblr` —
a fake "Pro tier profile card" SaaS using Next.js + Supabase Auth +
Stripe + OpenAI. Every credential in it is a `DEMOFAKE…` placeholder.
You can clone the repo and run the scanner against it in 10 seconds and
see what the output looks like.

The scanner is also tested against six edge-case fixtures: a clean
baseline (must produce zero findings), C2 history-only, C8 alternate-host
(Fly → CRITICAL escalation), C3 test-file suppression, an inline
suppression comment, and a no-git fallback test. Any change that breaks
`7 passed, 0 failed` doesn't merge.

It's MIT licensed. Happy to take feedback.

https://github.com/Anic888/predeploy-audit-nextjs

---

## Vercel community / r/nextjs / Indie Hackers — long-form post

**Title:**

I built a 9-check pre-deploy security audit for solo Next.js devs (after
shipping a few embarrassing bugs to Vercel myself)

**Body:**

A few times now I've pushed a weekend project to Vercel and only later
realized I'd done something dumb — `NEXT_PUBLIC_OPENAI_API_KEY`,
forgetting to enable RLS on a Supabase table, or shipping a Stripe
webhook handler that never actually verified the signature. None of
these are exotic. They're the same handful of mistakes solo devs make,
over and over.

I wanted a tool that would run in under a minute, with zero config, and
catch *only the things solo devs actually ship*. Not OWASP theory. Not
"here are 47 medium-severity findings, please triage." Just: am I about
to leak my OpenAI key? Did I forget RLS? Is my Stripe webhook actually
verifying anything?

So I built [predeploy-audit](https://github.com/Anic888/predeploy-audit-nextjs).

### What it checks

Nine things. Documented in [CHECKS.md](https://github.com/Anic888/predeploy-audit-nextjs/blob/main/CHECKS.md). Each one has a
real public incident behind it.

The most differentiated checks:

**Supabase RLS missing.** This is the [Lovable / CVE-2025-48757
incident](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/)
— 170+ apps had public-schema tables with no RLS, 13K users leaked from
one of them via a password-reset-token table. The scanner parses your
`supabase/migrations/*.sql` and emits a finding for every `CREATE TABLE
public.*` without a matching `ENABLE ROW LEVEL SECURITY`.

**Stripe webhook signature missing.** CVE-2026-21894. The handler imports
stripe, reads the body, never calls `constructEvent`. Forge a webhook,
get a free upgrade. The scanner detects this pattern in your `app/api/`
or `pages/api/` files.

**Service-role key in client code.** You wrote `createClient(url,
process.env.SUPABASE_SERVICE_ROLE_KEY)` in a file marked `"use client"`.
Your service-role key is now in everyone's browser DevTools. The scanner
classifies your files (with strict rules — `components/**` without a
directive is treated as "ambiguous" and gets a manual-check item, never
a false hard finding).

**Next.js version + hosting context.** [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927)
is the middleware authorization bypass from March 2025 (CVSS 9.1).
Vercel announced their hosted deployments are auto-patched at the
platform level. Railway / Fly.io / Docker / Netlify / Render are NOT.
The scanner detects which host you're targeting (from `vercel.json`,
`fly.toml`, `railway.toml`, `Dockerfile`, etc.) and frames the same
vulnerable version as LOW for Vercel and CRITICAL for self-hosted. **This
is the part I'm proudest of** — it's the kind of context-awareness that
GitHub's secret scanner and gitleaks fundamentally can't have.

### What it doesn't do

It is deliberately not a general security scanner. It doesn't do SQL
injection, XXE, file upload validation, CSRF tokens, rate limiting,
permissive CORS, missing auth on every API route, or unsafe HTML
rendering in JSX. Each of those is real but has either too high a
false-positive risk for v1 or is well-covered by other tools (Semgrep,
CodeQL, etc.). The full list of intentional exclusions is in CHECKS.md.

### Why I think this is worth using

Three things:

1. **It runs in ~80ms.** Not 80 seconds, not 80 minutes. You can run it
   on every save if you want.
2. **It's deterministic and tested.** The repo includes a deliberately
   vulnerable demo app (`wobblr`) with a frozen contract: 7 critical /
   1 high / 1 low / 1 manual-check. If a scanner change drifts that
   contract, the regression suite fails. There's also a clean-baseline
   fixture that must produce zero findings — the anti-FP guarantee.
3. **It's biased toward trust over recall.** The three checks where
   classification is hard (Supabase service-role in client, Stripe
   webhook verification, Supabase RLS parsing) explicitly emit
   "manual-check" items when the scanner can't be sure. It would rather
   tell you "I couldn't verify this, please look" than fake a confident
   finding.

It's MIT licensed, single Node file, zero runtime dependencies. No
config. No account. No `npm install` required.

```bash
node predeploy-audit.mjs /path/to/your/app
```

I'd love feedback, especially on:

- Checks I should add for v1.1
- False positives on real apps (the regression suite is tight against
  wobblr but the world is bigger than wobblr)
- Edge cases in `next.config.js` parsing

https://github.com/Anic888/predeploy-audit-nextjs

---

## Reply templates for common questions

**"Why not just use Semgrep?"**

> Semgrep CE doesn't have a Next.js directory — its closest coverage is
> `typescript/react/security/audit/`, which catches unsafe HTML
> rendering in JSX but not `NEXT_PUBLIC_OPENAI_API_KEY`, missing
> Supabase RLS, missing Stripe webhook verification, or Next.js version
> CVEs with hosting context. Semgrep Pro advertises Next.js coverage
> but it's commercial. If you have Semgrep installed, run both. They're
> complementary.

**"Why not just use gitleaks / TruffleHog?"**

> Same answer at a different layer. Gitleaks catches secret strings but
> doesn't know about `NEXT_PUBLIC_` semantics, doesn't read your
> `next.config.js`, doesn't classify your files into client/server. Run
> both.

**"Doesn't Vercel already do this?"**

> Vercel's [secret scanner](https://vercel.com/changelog/new-token-formats-and-secret-scanning)
> is good at detecting Vercel's own tokens (vcp/vci/vca/vcr/vck) leaked
> on public GitHub. It doesn't audit your source for OpenAI / Stripe /
> Supabase / AWS keys, doesn't know about Next.js client/server
> boundaries, doesn't verify Supabase RLS — and **none of it runs on
> Railway / Fly.io / Docker at all**.

**"What about [check X] that you don't have?"**

> Almost certainly intentional. CHECKS.md has a "what predeploy-audit
> deliberately does NOT catch" section with the reason for every
> excluded class. If your suggestion isn't there, that's a real
> contribution — open an issue.

**"Is this AI-generated code?"**

> The implementation was written collaboratively with Claude, but the
> design discipline matters more than that — there's a frozen
> regression suite, the trust model is documented, and every check has
> public incident evidence behind it. The full design history is in
> the repo (Phase 1 research, Phase 2 design, Phase 3 demo, Phase 4
> implementation).

---

## Notes for myself before posting

- Don't oversell "AI security." The hook is "vibe-coded Next.js audit",
  not "the AI security tool." AI is incidental.
- Don't claim it's a replacement for Semgrep / CodeQL. It isn't. It's a
  complement.
- Don't claim the regression suite makes it bug-free. It makes it
  *non-regressing* against a known surface, which is a different and
  more honest claim.
- Lead with a concrete finding example, not a feature list.
- The 80ms number is real and surprising — use it.
- The Vercel-vs-self-hosted CVE framing is the most differentiated
  thing. If I only get one line of attention, that's the line.
