# Hacker News Show HN — ready to paste

**How to post:**

1. Go to https://news.ycombinator.com/submit
2. Paste the **title** below into the "title" field
3. Paste the GitHub URL into the "url" field:
   `https://github.com/Anic888/predeploy-audit-nextjs`
4. Paste the **body** below into the "text" field
5. Submit

---

## Title (78 / 80 chars)

```
Show HN: Predeploy-audit – a 9-check security scan for vibe-coded Next.js apps
```

## URL field

```
https://github.com/Anic888/predeploy-audit-nextjs
```

## Body (paste into "text" field)

I built this because every time I'm about to push a hobby project to Vercel or Railway I wanted a 30-second sanity check, and the existing options were either too narrow (gitleaks/TruffleHog only catch raw secret strings), too heavy (Semgrep/CodeQL want install + ruleset config), or too commercial (paid black-box scanners that can't see your source).

The goal was small and trust-first. 9 checks. Not 90. Each check is in the tool because it has caused a real public incident in indie / vibe-coded apps:

- C1/C2: .env* tracked or in git history (Toyota leaked 270K customers via a 5-year-old .env; GitHub saw 39M+ leaked secrets in 2024)
- C3: Hardcoded OpenAI / Anthropic / Stripe / Supabase / AWS / GitHub / Google keys in source (~1,748 unique credentials found across 10K webpages in one research scan)
- C4: NEXT_PUBLIC_* / VITE_* / REACT_APP_* variables holding secrets (the canonical vibe-coded mistake — 84% of leaked keys came from publicly accessible JavaScript bundles)
- C5: Supabase service-role key referenced from "use client" components (the AI assistant prompt-injection failure mode)
- C6: Stripe webhook handlers missing stripe.webhooks.constructEvent — directly mirrors CVE-2026-21894 (n8n)
- C7: Supabase tables created without RLS — directly mirrors CVE-2025-48757 (170+ Lovable apps exposed; 13K users leaked from one app)
- C8: Vulnerable Next.js version against CVE-2025-29927 (CVSS 9.1 middleware auth bypass) and CVE-2024-34351, with hosting-platform aware severity — Vercel auto-patches CVE-2025-29927 so it's LOW for Vercel-hosted apps but CRITICAL for Railway / Fly.io / Docker
- C9: remotePatterns wildcard in next.config (SSRF surface from CVE-2024-34351's underlying class)

Implementation notes:

- Single ~2000 LoC Node ESM file. Zero runtime deps. Node 18+ and git only.
- ~80ms on a typical hobby app
- Deterministic — same input, same output, byte for byte
- Three of the checks (C5, C6, C7) are explicitly tri-state. They emit "manual-check" items when the scanner can't classify with full confidence, so it never fakes certainty.
- Suppression via inline `// @predeploy-ignore: <reason>` comments; suppressed findings are still shown in the summary, never silently hidden.

Trust model:

- Comments and string literals are stripped before identifier matching (so a doc comment mentioning SUPABASE_SERVICE_ROLE_KEY doesn't fire)
- Narrow regexes only — no entropy heuristics
- Strict file classification: components/** and lib/** without an explicit "use client" / "use server" directive are *ambiguous*, not assumed client. They emit manual-check items, never hard findings.

What it deliberately does NOT do: SQL injection, XXE, dynamic code execution, HTTPS, file upload, open redirect, weak passwords, CSRF, missing route auth, rate limiting, unsafe HTML in JSX, permissive CORS, public Storage buckets. Each excluded check is documented in CHECKS.md with the reason (mostly: too false-positive-prone, well-covered by other tools, or genuinely rare in indie Next.js).

The repo ships with a deliberately vulnerable demo app called wobblr — a fake "Pro tier profile card" SaaS using Next.js + Supabase Auth + Stripe + OpenAI. Every credential is a DEMOFAKEKEY12345QQQQ placeholder (20-char tail, well below real Stripe key minimums). Clone the repo, run the scanner against demo-vulnerable-app/wobblr/, see what the output looks like in 10 seconds.

The scanner is also tested against six edge-case fixtures: clean-baseline (must produce zero findings), C2 history-only, C8 alternate-host (Fly → CRITICAL escalation), C3 test-file suppression, an inline @predeploy-ignore comment, and a no-git fallback test. Any change that breaks `7 passed, 0 failed` doesn't merge — and CI runs the suite on Ubuntu + macOS × Node 18/20/22.

It's MIT licensed. Happy to take feedback on what to add for v1.1, false positives on real apps, and edge cases in next.config.js parsing.

https://github.com/Anic888/predeploy-audit-nextjs
