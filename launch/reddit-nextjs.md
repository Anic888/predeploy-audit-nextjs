# Reddit r/nextjs — ready to paste

Reddit's r/nextjs (and r/webdev, r/SideProject) are sensitive to self-promotion. The post below leads with a problem the audience recognizes, includes the GitHub link as the natural answer, and avoids buzzword pitches.

**How to post:**

1. Go to https://www.reddit.com/r/nextjs/submit
2. Choose "Post" (text post, not link post — text posts get more engagement on r/nextjs)
3. Paste the title
4. Paste the body
5. Add the flair "Discussion" or "Resource" if available
6. Submit

**Don't** post simultaneously to r/webdev, r/SideProject, r/javascript — wait at least 24 hours between subreddits to avoid Reddit's anti-spam filters and to read feedback before reposting elsewhere.

---

## Title

```
Tiny pre-deploy security audit I wrote after shipping NEXT_PUBLIC_OPENAI_API_KEY one too many times
```

(Alt title — slightly less self-deprecating:)

```
A 9-check pre-deploy security scanner for Next.js / Supabase / Stripe apps (open source, ~80ms, no deps)
```

---

## Body

I've shipped Next.js side-projects to Vercel, Railway and Fly.io for a while now. Three mistakes I've made personally, and seen a lot of others make:

1. `NEXT_PUBLIC_OPENAI_API_KEY` in `.env.local` because the client needed to call OpenAI directly. Embedded into the bundle. Visible in DevTools.
2. Forgetting to enable RLS on a Supabase table created via a fresh migration. Anon key reads everything.
3. Stripe webhook handler that reads `request.text()`, parses JSON, dispatches on `event.type` — and never calls `stripe.webhooks.constructEvent`. Anyone can POST a forged event and trigger upgrades.

None of these are exotic. None of them get caught by GitHub secret scanning, because GitHub only knows about its own partner formats and doesn't understand framework semantics. Semgrep CE doesn't have a Next.js directory. gitleaks is great but doesn't read your `next.config.js` or your migrations.

So I wrote a small scanner: [predeploy-audit](https://github.com/Anic888/predeploy-audit-nextjs).

```bash
node skill/scanner/predeploy-audit.mjs /path/to/your/app
```

Nine checks. ~80ms. Zero deps. Single Node file.

The most useful one — at least for me — is the Next.js version check with hosting-platform context. CVE-2025-29927 (the middleware auth bypass from March, CVSS 9.1) is auto-patched on Vercel but **not** on Railway / Fly / Docker. The scanner detects which host you're targeting (from `vercel.json`, `fly.toml`, `railway.toml`, `Dockerfile`) and frames the same vulnerable Next.js version differently — LOW for Vercel, CRITICAL for self-hosted. That's the kind of context-awareness GitHub can't have.

Other checks: Supabase service-role key in `"use client"` files, Stripe webhook missing `constructEvent`, Supabase tables without `ENABLE ROW LEVEL SECURITY`, `remotePatterns: "**"` wildcard in `next.config.js`, hardcoded OpenAI/Stripe/AWS/etc. keys in source, `.env*` tracked or in git history.

It's deliberately narrow. If you want a full security audit, run Semgrep or CodeQL — this is meant for "I'm about to push to prod and I want a 30-second sanity check."

Trust matters more than recall. Three of the checks are explicitly tri-state — they emit "manual-check" items when classification is ambiguous, instead of guessing. The repo ships with a 7-fixture regression suite (deliberately vulnerable demo + clean baseline + 5 edge cases) and CI runs it on Ubuntu + macOS × Node 18/20/22 on every push.

MIT. Single file. No npm install needed.

### Try it on the included demo

```bash
git clone https://github.com/Anic888/predeploy-audit-nextjs.git
cd predeploy-audit-nextjs
node skill/scanner/predeploy-audit.mjs demo-vulnerable-app/wobblr
```

The demo is a fake "Pro tier profile card" SaaS with 8 baked-in mistakes and a frozen expected-findings contract. Every credential in it is a `DEMOFAKE…` placeholder.

### What I'm asking for

- If you've shipped a Next.js app to Vercel, Railway, or Fly recently and have a moment, would love it if you ran this against your repo and told me if it found anything real (or false-positived on something legit)
- Specifically interested in feedback on `lib/`-style helpers — that's the main path where the scanner has to choose between hard-finding and manual-check, and I'd love to know if the heuristic is right on real codebases
- Open issues / PRs welcome

Repo: https://github.com/Anic888/predeploy-audit-nextjs
