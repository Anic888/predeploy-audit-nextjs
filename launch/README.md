# launch/

Ready-to-paste launch copy for predeploy-audit. Pick a channel, paste, ship.

| File | Channel | Format | Headline |
|---|---|---|---|
| [`twitter-thread.txt`](./twitter-thread.txt) | Twitter / X | 4-tweet thread, all ≤ 280 chars verified | "I built a tiny pre-deploy security scanner for indie Next.js apps" |
| [`hackernews.md`](./hackernews.md) | Hacker News (Show HN) | Title 78/80 chars + URL field + body | "Show HN: Predeploy-audit – a 9-check security scan for vibe-coded Next.js apps" |
| [`long-form.md`](./long-form.md) | Vercel community / Indie Hackers / dev.to / Hashnode | Long-form markdown post | "I built a 9-check pre-deploy security audit for solo Next.js devs" |
| [`reddit-nextjs.md`](./reddit-nextjs.md) | Reddit r/nextjs (and adaptable to r/webdev, r/SideProject) | Reddit-aware tone, leads with problem | "Tiny pre-deploy security audit I wrote after shipping NEXT_PUBLIC_OPENAI_API_KEY one too many times" |

## Posting order suggestion

If you want to cross-post across channels, here's a sequence that won't trip
spam filters and that lets you read feedback before going wider:

1. **Day 0** — Post on Hacker News (Show HN). HN traffic is the most
   useful signal for whether the technical pitch lands. Watch the
   comments for genuine feedback.
2. **Day 0 + 2 hours** — Post the Twitter thread. Wait 2 hours after HN
   so the HN URL has stabilized.
3. **Day 1** — Post on r/nextjs. Reddit's anti-spam gets unhappy about
   simultaneous cross-posts.
4. **Day 2+** — Post the long-form to Indie Hackers / Vercel community
   forum / dev.to. By now you'll have feedback from HN you can fold
   into the long-form post.

## Don't oversell

Each draft was deliberately written to:

- Lead with the problem, not the feature list
- Avoid "AI-powered security" framing — the AI angle is incidental
- Frame the tool as **complementary** to Semgrep/CodeQL/gitleaks, not a replacement
- Be honest about what it doesn't catch (each post links CHECKS.md)
- Lead with the most differentiated thing: the Vercel-vs-self-hosted
  CVE-2025-29927 framing. If you only get one line of attention, that's
  the line.

## Reply templates for common questions

These were drafted in the original LAUNCH.md and stay there for reference.
Common questions you'll get and how to answer them:

- **"Why not just use Semgrep?"** → Semgrep CE has no Next.js directory.
  Run both. They're complementary.
- **"Doesn't Vercel already do this?"** → Vercel's secret scanner only
  catches Vercel's own tokens. Doesn't audit your source for OpenAI /
  Stripe / Supabase keys. Doesn't run on Railway / Fly / Docker.
- **"Is this AI-generated code?"** → The implementation was written
  collaboratively with Claude, but the design discipline matters more —
  there's a frozen regression suite, a documented trust model, and every
  check has public incident evidence behind it.

Full reply templates are in [`../LAUNCH.md`](../LAUNCH.md).
