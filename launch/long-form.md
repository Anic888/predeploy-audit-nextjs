# Long-form post — ready to paste

For: Vercel Community, Indie Hackers, dev.to, Hashnode, Hacker News (as a comment), or any forum that allows markdown.

**How to post:**

1. Pick the title from below
2. Paste the body
3. The repo URL is already inlined throughout

---

## Title

```
I built a 9-check pre-deploy security audit for solo Next.js devs
```

(Alt title if the above feels too understated:)

```
A tiny pre-deploy security scanner for vibe-coded Next.js apps — 9 checks, 80ms, MIT
```

---

## Body

A few times now I've pushed a weekend project to Vercel and only later realized I'd done something dumb — `NEXT_PUBLIC_OPENAI_API_KEY`, forgetting to enable RLS on a Supabase table, or shipping a Stripe webhook handler that never actually verified the signature. None of these are exotic. They're the same handful of mistakes solo devs make, over and over.

I wanted a tool that would run in under a minute, with zero config, and catch *only* the things solo devs actually ship. Not OWASP theory. Not "here are 47 medium-severity findings, please triage." Just: am I about to leak my OpenAI key? Did I forget RLS? Is my Stripe webhook actually verifying anything?

So I built [predeploy-audit](https://github.com/Anic888/predeploy-audit-nextjs).

```bash
node skill/scanner/predeploy-audit.mjs /path/to/your/app
```

**~80ms.** Zero runtime dependencies. Single Node file. No npm install required.

### What it checks

Nine things. Documented in [CHECKS.md](https://github.com/Anic888/predeploy-audit-nextjs/blob/main/CHECKS.md). Each one has a real public incident behind it.

The most differentiated checks:

**Supabase RLS missing.** This is the [Lovable / CVE-2025-48757 incident](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/) — 170+ apps had public-schema tables with no RLS, and 13K users were leaked from one of them via a password-reset-token table. The scanner parses your `supabase/migrations/*.sql` and emits a finding for every `CREATE TABLE public.*` without a matching `ENABLE ROW LEVEL SECURITY`.

**Stripe webhook signature missing.** CVE-2026-21894. The handler imports stripe, reads the body, never calls `constructEvent`. Forge a webhook, get a free Pro upgrade. The scanner detects this pattern in your `app/api/` or `pages/api/` files.

**Service-role key in client code.** You wrote `createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)` in a file marked `"use client"`. Your service-role key is now in everyone's browser DevTools. The scanner classifies your files (with strict rules — `components/**` without a directive is treated as "ambiguous" and gets a manual-check item, never a false hard finding).

**Next.js version + hosting context.** [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927) is the middleware authorization bypass from March 2025 (CVSS 9.1). Vercel announced their hosted deployments are auto-patched at the platform level. Railway / Fly.io / Docker / Netlify / Render are NOT. The scanner detects which host you're targeting (from `vercel.json`, `fly.toml`, `railway.toml`, `Dockerfile`, etc.) and frames the same vulnerable version as LOW for Vercel and CRITICAL for self-hosted.

**This is the part I'm proudest of** — it's the kind of context-awareness that GitHub's secret scanner and gitleaks fundamentally can't have.

### What it doesn't do

It is deliberately not a general security scanner. It doesn't do SQL injection, XXE, file upload validation, CSRF tokens, rate limiting, permissive CORS, missing auth on every API route, or unsafe HTML rendering in JSX. Each of those is real but has either too high a false-positive risk for v1 or is well-covered by other tools (Semgrep, CodeQL, etc.). The full list of intentional exclusions is in CHECKS.md.

### Why I think this is worth using

Three things:

1. **It runs in ~80ms.** Not 80 seconds, not 80 minutes. You can run it on every save if you want.
2. **It's deterministic and tested.** The repo includes a deliberately vulnerable demo app (`wobblr`) with a frozen contract: 7 critical / 1 high / 1 low / 1 manual-check. If a scanner change drifts that contract, the regression suite fails. There's also a clean-baseline fixture that must produce zero findings — the anti-FP guarantee. CI runs the full suite on Ubuntu + macOS × Node 18/20/22.
3. **It's biased toward trust over recall.** The three checks where classification is hard (Supabase service-role in client, Stripe webhook verification, Supabase RLS parsing) explicitly emit "manual-check" items when the scanner can't be sure. It would rather tell you "I couldn't verify this, please look" than fake a confident finding.

### Try it on the demo

```bash
git clone https://github.com/Anic888/predeploy-audit-nextjs.git
cd predeploy-audit-nextjs
node skill/scanner/predeploy-audit.mjs demo-vulnerable-app/wobblr
```

You'll see 9 findings, organized by section, with a one-line fix for each. Total scan time: ~80ms.

### Use as a Claude Code skill

If you're using Claude Code, you can install the skill so that asking *"audit this for security before I deploy"* triggers it automatically:

```bash
ln -s /path/to/predeploy-audit-nextjs/skill ~/.agents/skills/predeploy-audit
```

### Roadmap

v1 deliberately ships nine checks. v1.1 candidates (CHECKS.md has the full list) include source-map detection, missing-auth on Next.js Server Actions, rate-limiting heuristics, and a JSON output mode for CI. Each future check has to clear the same bar v1 cleared: direct or CVE-level evidence, defendable detection logic, a new fixture in the regression suite *before* the check is added.

### Repo

[github.com/Anic888/predeploy-audit-nextjs](https://github.com/Anic888/predeploy-audit-nextjs) — MIT licensed.

I'd love feedback, especially on:

- Checks I should add for v1.1
- False positives on real apps (the regression suite is tight against wobblr but the world is bigger than wobblr)
- Edge cases in `next.config.js` parsing
