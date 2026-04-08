#!/usr/bin/env node
// Regression test runner for predeploy-audit.
//
// Each fixture is copied to a temporary workspace and (where needed)
// initialized as a git repo before the scanner runs against it. This
// makes the suite reproducible from a fresh `git clone` — no setup
// scripts, no committed nested .git directories, no state leaks
// between runs.
//
// Trust contract: 7 passed, 0 failed. Any change that breaks this
// suite is rejected per Phase 4 of the project design.

// We use execFileSync (NOT exec) — no shell, args are passed as a static array.
import * as nodeProc from "node:child_process";
const execFileSync = nodeProc.execFileSync;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCANNER = path.resolve(__dirname, "../skill/scanner/predeploy-audit.mjs");

const FIXTURES_SRC = path.resolve(__dirname, "fixtures");
const WOBBLR_SRC = path.resolve(__dirname, "../demo-vulnerable-app/wobblr");

// Per-process tmp workspace. Cleaned up at the end (success or failure).
const WORKSPACE = fs.mkdtempSync(
  path.join(os.tmpdir(), "predeploy-audit-tests-")
);

function runGit(cwd, ...args) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"]
  });
}

function copyTree(src, dest) {
  // Use fs.cp (Node 16.7+) which handles dirs recursively without subprocess.
  fs.cpSync(src, dest, {
    recursive: true,
    // Defensive: never copy a stray .git directory if one is present.
    filter: (s) => !s.split(path.sep).includes(".git")
  });
}

function gitInitAndCommit(dir) {
  runGit(dir, "init", "-q", "-b", "main");
  runGit(dir, "config", "user.email", "regression@predeploy-audit.example");
  runGit(dir, "config", "user.name", "regression");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-q", "-m", "fixture");
}

// Special-case prepare for c2-history-only: needs .env added in commit 1
// then removed in commit 2. The fixture's source doesn't include .env
// (we don't want to ship a fake secret in the canonical repo's tracked
// files outside of wobblr / .env.example), so we materialize .env at
// prepare time.
function prepareC2HistoryOnly(dir) {
  // Write the .env first. The tail is exactly 20 chars (our C3 regex
  // minimum) and is obviously fake — it cannot possibly authenticate.
  fs.writeFileSync(
    path.join(dir, ".env"),
    "STRIPE_SECRET_KEY=sk_live_DEMOFAKEKEY12345QQQQ\n"
  );
  runGit(dir, "init", "-q", "-b", "main");
  runGit(dir, "config", "user.email", "regression@predeploy-audit.example");
  runGit(dir, "config", "user.name", "regression");
  runGit(dir, "add", ".gitignore", "package.json", ".env");
  runGit(dir, "commit", "-q", "-m", "oops: added .env with secret");
  // Remove in second commit
  runGit(dir, "rm", "-q", ".env");
  fs.appendFileSync(path.join(dir, ".gitignore"), ".env\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-q", "-m", "remove .env, add to gitignore");
}

const cases = [
  {
    name: "wobblr (frozen contract)",
    src: WOBBLR_SRC,
    prepare: gitInitAndCommit,
    expected: {
      critical: 7,
      high: 1,
      low: 1,
      manualCheck: 1,
      testFileMatches: 0,
      userSuppressed: 0,
      mustIncludeHeaders: [
        "🟥 CRITICAL — C1: .env file tracked in git",
        "🟥 CRITICAL — C3: Hardcoded Stripe live secret key in tracked source",
        "🟥 CRITICAL — C3: Hardcoded Stripe webhook signing secret in tracked source",
        "🟥 CRITICAL — C4: Client-exposed secret variable",
        "🟥 CRITICAL — C5: Supabase service-role key in client-reachable code",
        "🟥 CRITICAL — C6: Stripe webhook handler missing signature verification",
        "🟥 CRITICAL — C7: Supabase table created without Row-Level Security",
        "🟧 HIGH — C9: Unrestricted image remote hostnames",
        "🟦 LOW — C8: Next.js 14.2.10 vulnerable to CVE-2025-29927",
        "⚠️  C5: Could not verify safety of Supabase service-role reference"
      ],
      mustNotIncludeHeaders: [
        // D3 trap: app/u/[username]/page.tsx must NOT produce a C5 finding
        "C5: Supabase service-role key in client-reachable code\n   File: app/u/",
        // D6 trap: components/UserBio.tsx must NOT appear in any C5 output
        "components/UserBio.tsx",
        // D5: lib/stripe-helpers.ts must NOT trip C6
        "C6: Stripe webhook handler missing signature verification\n   File: lib/stripe-helpers.ts"
      ]
    }
  },
  {
    name: "clean-baseline (zero findings)",
    src: path.join(FIXTURES_SRC, "clean-baseline"),
    prepare: gitInitAndCommit,
    expected: {
      critical: 0,
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 0,
      userSuppressed: 0,
      mustIncludeHeaders: [],
      mustNotIncludeHeaders: ["🟥", "🟧", "🟦", "⚠️"]
    }
  },
  {
    name: "c2-history-only",
    src: path.join(FIXTURES_SRC, "c2-history-only"),
    prepare: prepareC2HistoryOnly,
    expected: {
      critical: 1,
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 0,
      userSuppressed: 0,
      mustIncludeHeaders: [
        "🟥 CRITICAL — C2: .env file present in git history (not in HEAD)"
      ],
      mustNotIncludeHeaders: [
        "🟥 CRITICAL — C1:" // C1 must NOT fire — file is not in HEAD
      ]
    }
  },
  {
    name: "c8-fly-host (escalates LOW → CRITICAL)",
    src: path.join(FIXTURES_SRC, "c8-fly-host"),
    prepare: gitInitAndCommit,
    expected: {
      critical: 1,
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 0,
      userSuppressed: 0,
      mustIncludeHeaders: [
        "🟥 CRITICAL — C8: Next.js 14.2.10 vulnerable to CVE-2025-29927"
      ],
      mustNotIncludeHeaders: [
        "🟦 LOW — C8:" // must NOT be the LOW Vercel framing
      ]
    }
  },
  {
    name: "c3-test-files (test-file Q1 path)",
    src: path.join(FIXTURES_SRC, "c3-test-files"),
    prepare: gitInitAndCommit,
    expected: {
      critical: 0,
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 1,
      userSuppressed: 0,
      mustIncludeHeaders: [],
      mustNotIncludeHeaders: ["🟥 CRITICAL — C3:"]
    }
  },
  {
    name: "suppression-comment",
    src: path.join(FIXTURES_SRC, "suppression-comment"),
    prepare: gitInitAndCommit,
    expected: {
      critical: 0,
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 0,
      userSuppressed: 1,
      mustIncludeHeaders: [],
      mustNotIncludeHeaders: ["🟥", "🟧 HIGH — C9:"]
    }
  },
  {
    name: "no-git (C3 fallback walker)",
    src: path.join(FIXTURES_SRC, "no-git"),
    prepare: () => {
      // Intentionally do NOT init git. This fixture exists to verify
      // the scanner's filesystem-walker fallback for C1/C3/C5/etc.
      // when the target directory is not a git repository.
    },
    expected: {
      critical: 1, // one C3 finding on the hardcoded sk_live_ key
      high: 0,
      low: 0,
      manualCheck: 0,
      testFileMatches: 0,
      userSuppressed: 0,
      mustIncludeHeaders: [
        "🟥 CRITICAL — C3: Hardcoded Stripe live secret key in tracked source"
      ],
      mustNotIncludeHeaders: []
    }
  }
];

function runScanner(dir) {
  return execFileSync("node", [SCANNER, dir], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}

function parseSummary(out) {
  const m = out.match(
    /(\d+) critical • (\d+) high • (\d+) low • (\d+) manual-check • (\d+) test-file matches • (\d+) user-suppressed/
  );
  if (!m) return null;
  return {
    critical: parseInt(m[1], 10),
    high: parseInt(m[2], 10),
    low: parseInt(m[3], 10),
    manualCheck: parseInt(m[4], 10),
    testFileMatches: parseInt(m[5], 10),
    userSuppressed: parseInt(m[6], 10)
  };
}

let pass = 0;
let fail = 0;
const failures = [];

try {
  for (const c of cases) {
    process.stdout.write(`• ${c.name}: `);
    let out;
    try {
      // Copy fixture into the workspace
      const dest = path.join(WORKSPACE, c.name.replace(/[^\w-]/g, "_"));
      copyTree(c.src, dest);
      // Prepare (init git, etc.)
      c.prepare(dest);
      // Run scanner
      out = runScanner(dest);
    } catch (err) {
      process.stdout.write("FAIL (setup error)\n");
      const stderr = err && err.stderr ? err.stderr.toString() : "";
      failures.push({
        name: c.name,
        errs: [`setup: ${String(err.message || err)}${stderr ? "\n" + stderr : ""}`]
      });
      fail++;
      continue;
    }

    const summary = parseSummary(out);
    const errs = [];
    if (!summary) {
      errs.push("could not parse summary line");
    } else {
      for (const k of [
        "critical",
        "high",
        "low",
        "manualCheck",
        "testFileMatches",
        "userSuppressed"
      ]) {
        if (summary[k] !== c.expected[k]) {
          errs.push(`${k}: expected ${c.expected[k]}, got ${summary[k]}`);
        }
      }
    }
    for (const must of c.expected.mustIncludeHeaders) {
      if (!out.includes(must)) {
        errs.push(`missing required header: ${must}`);
      }
    }
    for (const mustNot of c.expected.mustNotIncludeHeaders) {
      if (out.includes(mustNot)) {
        errs.push(`forbidden substring present: ${mustNot}`);
      }
    }

    if (errs.length === 0) {
      process.stdout.write("PASS\n");
      pass++;
    } else {
      process.stdout.write("FAIL\n");
      for (const e of errs) process.stdout.write(`    - ${e}\n`);
      failures.push({ name: c.name, errs, output: out });
      fail++;
    }
  }
} finally {
  // Cleanup workspace
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  } catch {}
}

console.log("");
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("");
  console.log("=== Failure details ===");
  for (const f of failures) {
    console.log(`--- ${f.name} ---`);
    if (f.errs) for (const e of f.errs) console.log(`  ${e}`);
    if (f.output) console.log(f.output);
    console.log("");
  }
  process.exit(1);
}
