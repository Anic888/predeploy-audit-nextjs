# wobblr

> ⚠️ **THIS IS AN INTENTIONALLY VULNERABLE DEMO APP. DO NOT DEPLOY IT.
> DO NOT USE IT AS A STARTER. EVERY CREDENTIAL IN THIS REPO IS A FAKE
> PLACEHOLDER (`DEMOFAKE…`). NONE OF THEM ARE LIVE.**

## What this is

A tiny Next.js + Supabase + Stripe + OpenAI app — a "Pro tier profile
card" SaaS that a solo developer might build over a weekend. It's
deliberately broken in 8 specific, plausible ways so we can verify
that the **predeploy-audit** Claude Code skill catches each one
without false-positiving on any of the legitimate-looking patterns
in the same repo.

It's a regression target, not a real product.

For the exact list of intended vulnerabilities and the expected
scanner output, see [`EXPECTED_FINDINGS.md`](./EXPECTED_FINDINGS.md).

## Why `.env.local` is committed

This is **deliberate**. The whole point of check `C1` (tracked
`.env*` in git) is to detect this exact mistake. The committed
`.env.local` contains only `DEMOFAKE…`-marked placeholder values
that match the *shape* of real credentials (so the scanner's regexes
fire) but cannot possibly authenticate anywhere. They are flagged
in the file with a warning header.

**Do not copy this `.env.local` into a real project.** Real apps
must list `.env.local` in `.gitignore` and never commit it.

## How to run it

```bash
npm install
npm run dev
```

The landing page renders at <http://localhost:3000>. The dashboard,
public profile, and API routes are wired up but won't do anything
useful without real Supabase / Stripe / OpenAI accounts — and
intentionally so. The vulnerabilities are static and don't need
runtime to detect.

Tested working with:
- Node v22.22.0
- npm 10.9.4
- next 14.2.10 (intentionally vulnerable; see C8 finding)

## File map

```
wobblr/
├── .env.example            # safe template (decoy: scanner must not flag)
├── .env.local              # ⚠️ tracked in git (V1) — fake values only
├── .gitignore              # deliberately omits .env.local
├── package.json            # next@14.2.10 (V7)
├── next.config.mjs         # remotePatterns wildcard (V8)
├── vercel.json             # triggers C8 host inference → Vercel → LOW framing
├── supabase/
│   └── migrations/
│       └── 20260101000000_init.sql   # CREATE TABLE without RLS (V6)
├── app/
│   ├── layout.tsx, page.tsx          # clean
│   ├── dashboard/page.tsx            # ⚠️ "use client" + service-role key (V4)
│   ├── api/stripe/webhook/route.ts   # ⚠️ no signature verification (V5)
│   ├── api/ai/describe/route.ts      # decoy: correct server-side OpenAI usage
│   └── u/[username]/page.tsx         # decoy: correct anon-key public page
├── components/
│   ├── BillingBanner.tsx             # decoy: correct publishable-key usage
│   └── UserBio.tsx                   # decoy: ambiguous classification, no
│                                     #         service-role reference
└── lib/
    ├── supabase-admin.ts             # decoy: tri-state UNCERTAIN test (D7)
    └── stripe-helpers.ts             # decoy: correct Stripe verification
```

## License

MIT — but seriously, do not deploy this.
