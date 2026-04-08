#!/usr/bin/env node
// predeploy-audit — fast pre-deploy security audit for indie Next.js +
// Supabase + Stripe apps. Implements the 9 Core v1 checks designed in
// the Phase 2 report of this project. Each check below is anchored to
// its Phase 2 section (§C1..§C9) so future maintainers can trace a
// detection line back to the design decision that authorized it.
//
// Trust-first design:
//   * Deterministic file/regex/version checks
//   * Tri-state UNCERTAIN outcomes where classification is ambiguous
//   * Comment/string-literal stripping before pattern matches (§C5)
//   * Narrow format regexes only (§C3) — no entropy heuristics
//   * Every finding includes a concrete fix
//
// No runtime dependencies. Node built-ins only. Subprocess calls go
// exclusively through execFileSync (no shell, no string interpolation).

import fs from "node:fs";
import path from "node:path";
// We use execFileSync (NOT exec) for subprocess calls — no shell, no
// command-injection surface. All arguments are passed as a static array.
import * as nodeProc from "node:child_process";
const execFileSync = nodeProc.execFileSync;

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const deployGate = args.includes("--deploy-gate");
  const repoArg = args.find((a) => !a.startsWith("--")) ?? ".";
  const repo = path.resolve(repoArg);

  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    console.error(`predeploy-audit: not a directory: ${repo}`);
    process.exit(2);
  }

  const ctx = buildContext(repo);
  const results = runAllChecks(ctx);
  const report = formatReport(repo, results, { deployGate });
  process.stdout.write(report + "\n");

  if (deployGate) {
    const total = results.findings.length + results.uncertains.length;
    process.exit(total > 0 ? 1 : 0);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Context: collected once at startup, shared across checks
// ─────────────────────────────────────────────────────────────────────

function buildContext(repo) {
  const ctx = {
    repo,
    trackedFiles: [],
    isGit: false,
    pkg: null,
    lockfile: null,
    host: "unknown",
    supabaseDetected: false,
    nextDetected: false,
    nextVersion: null
  };

  try {
    const out = execFileSync("git", ["ls-files"], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    ctx.trackedFiles = out.split("\n").filter(Boolean);
    ctx.isGit = true;
  } catch {
    ctx.isGit = false;
  }

  const pkgPath = path.join(repo, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      ctx.pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      ctx.pkg = null;
    }
  }

  ctx.lockfile = detectLockfile(repo);

  if (ctx.pkg) {
    const allDeps = {
      ...(ctx.pkg.dependencies || {}),
      ...(ctx.pkg.devDependencies || {})
    };
    ctx.supabaseDetected =
      "@supabase/supabase-js" in allDeps ||
      fs.existsSync(path.join(repo, "supabase"));
    ctx.nextDetected = "next" in allDeps;
    if (ctx.nextDetected) {
      ctx.nextVersion = resolveNextVersion(
        repo,
        ctx.lockfile,
        allDeps.next
      );
    }
  } else {
    ctx.supabaseDetected = fs.existsSync(path.join(repo, "supabase"));
  }

  ctx.host = inferHost(repo);
  return ctx;
}

function detectLockfile(repo) {
  const candidates = [
    { kind: "pnpm", name: "pnpm-lock.yaml" },
    { kind: "yarn", name: "yarn.lock" },
    { kind: "bun", name: "bun.lockb" },
    { kind: "npm", name: "package-lock.json" }
  ];
  for (const c of candidates) {
    const p = path.join(repo, c.name);
    if (fs.existsSync(p)) {
      return {
        kind: c.kind,
        path: p,
        content: c.kind === "bun" ? null : fs.readFileSync(p, "utf8")
      };
    }
  }
  return null;
}

function resolveNextVersion(repo, lockfile, declaredRange) {
  if (lockfile) {
    if (lockfile.kind === "npm") {
      try {
        const parsed = JSON.parse(lockfile.content);
        const entry =
          parsed?.packages?.["node_modules/next"] ??
          parsed?.dependencies?.next;
        if (entry?.version) return entry.version;
      } catch {}
    } else if (lockfile.kind === "pnpm") {
      const m = lockfile.content.match(/\/next@([^\s:(]+)/);
      if (m) return m[1];
    } else if (lockfile.kind === "yarn") {
      const m = lockfile.content.match(
        /^"?next@[^\n]*:\s*\n\s*version\s+"?([^"\s]+)/m
      );
      if (m) return m[1];
    }
  }

  const nmPkg = path.join(repo, "node_modules/next/package.json");
  if (fs.existsSync(nmPkg)) {
    try {
      return JSON.parse(fs.readFileSync(nmPkg, "utf8")).version;
    } catch {}
  }

  if (declaredRange) {
    const m = declaredRange.match(/\d+\.\d+\.\d+/);
    if (m) return m[0];
  }

  return null;
}

function inferHost(repo) {
  if (
    fs.existsSync(path.join(repo, "vercel.json")) ||
    fs.existsSync(path.join(repo, ".vercel/project.json"))
  ) {
    return "vercel";
  }
  if (fs.existsSync(path.join(repo, "fly.toml"))) return "fly";
  if (
    fs.existsSync(path.join(repo, "railway.toml")) ||
    fs.existsSync(path.join(repo, "railway.json"))
  ) {
    return "railway";
  }
  if (fs.existsSync(path.join(repo, "netlify.toml"))) return "netlify";
  if (fs.existsSync(path.join(repo, "render.yaml"))) return "render";
  if (fs.existsSync(path.join(repo, "Dockerfile"))) return "docker";
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 §2.1.1: file classification (Q2 strict form)
// ─────────────────────────────────────────────────────────────────────

function classifyFile(repo, relPath) {
  let head = "";
  try {
    const fd = fs.openSync(path.join(repo, relPath), "r");
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    head = buf.slice(0, n).toString("utf8");
  } catch {
    return "ambiguous";
  }
  const directive = extractTopDirective(head);
  if (directive === "use server") return "server-only";
  if (directive === "use client") return "client-reachable";
  if (/^\s*import\s+["']server-only["']/m.test(head)) return "server-only";

  const p = relPath.replace(/\\/g, "/");

  if (/^pages\/api\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)) return "server-only";
  if (/^app\/.*\/route\.(ts|js|mjs|cjs)$/.test(p)) return "server-only";
  if (/^middleware\.(ts|js|mjs|cjs)$/.test(p)) return "server-only";
  if (/^src\/middleware\.(ts|js|mjs|cjs)$/.test(p)) return "server-only";
  if (/^lib\/server\//.test(p)) return "server-only";
  if (/^server\//.test(p)) return "server-only";
  if (/^src\/server\//.test(p)) return "server-only";
  if (/^scripts\//.test(p)) return "server-only";
  if (/^drizzle\//.test(p) || /^prisma\//.test(p)) return "server-only";

  // Pages Router non-API pages → always client-reachable
  if (/^pages\/.*\.(tsx|jsx)$/.test(p) && !/^pages\/api\//.test(p)) {
    return "client-reachable";
  }

  // components/** without directive → AMBIGUOUS (Q2 strict rule)
  if (/^components\//.test(p)) return "ambiguous";

  if (/^app\/.*\/(page|layout|template|loading|error|not-found)\.(tsx|jsx)$/.test(p)) {
    return "ambiguous";
  }
  if (/^app\/.*\.(tsx|jsx)$/.test(p)) return "ambiguous";

  return "ambiguous";
}

function extractTopDirective(source) {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) continue;
    const m = line.match(/^(?:"|')(use client|use server)(?:"|')\s*;?$/);
    if (m) return m[1];
    return null;
  }
  return null;
}

// Strip line comments, block comments, and string literals from JS/TS
// source. Used by C5 so SERVICE_ROLE references inside comments do not
// match. Minimal lexer — adequate for narrow identifier scans.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];

    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (quote === "`" && ch === "$" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// §C3 curated secret format regexes — narrow, known-format only
// ─────────────────────────────────────────────────────────────────────

const SECRET_FORMATS = [
  {
    id: "openai",
    label: "OpenAI API key",
    re: /\bsk-proj-[A-Za-z0-9_\-]{20,}\b/,
    rotateUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "openai-legacy",
    label: "OpenAI API key (legacy)",
    re: /\bsk-[A-Za-z0-9]{20,}\b/,
    rotateUrl: "https://platform.openai.com/api-keys",
    reject: /^sk-(proj-|ant-)/
  },
  {
    id: "anthropic",
    label: "Anthropic API key",
    re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/,
    rotateUrl: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "stripe-live-secret",
    label: "Stripe live secret key",
    re: /\bsk_live_[A-Za-z0-9]{20,}\b/,
    rotateUrl: "https://dashboard.stripe.com/apikeys"
  },
  {
    id: "stripe-webhook",
    label: "Stripe webhook signing secret",
    re: /\bwhsec_[A-Za-z0-9]{20,}\b/,
    rotateUrl: "https://dashboard.stripe.com/webhooks"
  },
  {
    id: "aws-access-key",
    label: "AWS access key ID",
    re: /\bAKIA[0-9A-Z]{16}\b/,
    rotateUrl:
      "https://console.aws.amazon.com/iam/home#/security_credentials"
  },
  {
    id: "github-pat",
    label: "GitHub personal access token",
    re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
    rotateUrl: "https://github.com/settings/tokens"
  },
  {
    id: "google-api",
    label: "Google Cloud API key",
    re: /\bAIza[0-9A-Za-z\-_]{35}\b/,
    rotateUrl: "https://console.cloud.google.com/apis/credentials"
  }
];

const PLACEHOLDER_MARKERS = [
  "your-",
  "your_",
  "YOUR_",
  "<your-",
  "REPLACE_ME",
  "REPLACEME",
  "xxxxx",
  "XXXXX",
  "placeholder",
  "PLACEHOLDER",
  "example",
  "EXAMPLE",
  "TODO",
  "dummy",
  "DUMMY",
  "redacted",
  "REDACTED"
];

function lineHasPlaceholder(line) {
  return PLACEHOLDER_MARKERS.some((m) => line.includes(m));
}

// Match a line against curated secret formats. Returns first match.
// NOTE: DEMOFAKE markers used in the wobblr regression target are
// intentionally NOT in PLACEHOLDER_MARKERS — the demo's contract
// requires those strings to be detected by C3.
function matchSecretFormat(text) {
  for (const fmt of SECRET_FORMATS) {
    const m = text.match(fmt.re);
    if (m) {
      if (fmt.reject && fmt.reject.test(m[0])) continue;
      return { format: fmt, match: m[0] };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// File walk helpers
// ─────────────────────────────────────────────────────────────────────

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".vercel",
  ".turbo",
  "vendor",
  ".cache"
]);

const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);

// Phase 3 clarification: C5 only scans code file extensions, not .env*.
const SOURCE_CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);

const TEST_FILE_RES = [
  /\/__tests__\//,
  /\/tests?\//,
  /\/spec\//,
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/
];

function isTestFile(relPath) {
  const p = relPath.replace(/\\/g, "/");
  return TEST_FILE_RES.some((re) => re.test(p));
}

function readEnvFilesRecursive(repo) {
  const out = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relChild = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        walk(full, relChild);
      } else if (entry.isFile()) {
        if (/^\.env(\..*)?$/.test(entry.name)) {
          try {
            const content = fs.readFileSync(full, "utf8");
            out.push({ relPath: relChild, lines: content.split("\n") });
          } catch {}
        }
      }
    }
  }
  walk(repo, "");
  return out;
}

function getSourceFiles(ctx) {
  const files = ctx.isGit
    ? ctx.trackedFiles.filter((f) => SOURCE_CODE_EXTS.has(path.extname(f)))
    : [];
  if (files.length > 0) return files;

  const out = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const relChild = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(full, relChild);
      else if (e.isFile() && SOURCE_CODE_EXTS.has(path.extname(e.name))) {
        out.push(relChild);
      }
    }
  }
  walk(ctx.repo, "");
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Suppression: // @predeploy-ignore: <reason>
// ─────────────────────────────────────────────────────────────────────

function findSuppressionOnLine(source, lineNum) {
  const lines = source.split("\n");
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const line = lines[idx];
  const m = line.match(/@predeploy-ignore:\s*([^\n]+)/);
  if (m) return m[1].trim();
  if (idx > 0) {
    const prev = lines[idx - 1];
    const m2 = prev.match(/@predeploy-ignore:\s*([^\n]+)/);
    if (m2) return m2[1].trim();
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Results and report
// ─────────────────────────────────────────────────────────────────────

function makeResults() {
  return {
    findings: [],
    uncertains: [],
    clean: [],
    suppressed: [],
    testFileMatches: 0
  };
}

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function formatReport(repo, results, opts = {}) {
  const { deployGate = false } = opts;
  const { findings, uncertains, clean, suppressed, testFileMatches } = results;

  const frameworkFindings = findings.filter((f) => f.ownership === "OWN");
  const hygieneFindings = findings.filter((f) => f.ownership === "PACKAGE");

  const sortBySeverity = (arr) =>
    [...arr].sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (s !== 0) return s;
      return a.check.localeCompare(b.check);
    });

  const lines = [];
  const repoName = path.basename(repo);
  const mode = deployGate ? "deploy-gate" : "normal";

  lines.push("# Pre-deploy security audit");
  lines.push("");
  lines.push(`Target: ${repoName}`);
  lines.push(`Mode: ${mode}`);
  lines.push(`Ran 9 checks.`);
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("## Framework-specific findings");
  lines.push(
    "(The Next.js / Supabase / Stripe mistakes you were unlikely to catch otherwise.)"
  );
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");
  if (frameworkFindings.length === 0) {
    lines.push("(none)");
    lines.push("");
  } else {
    for (const f of sortBySeverity(frameworkFindings)) {
      lines.push(...renderFinding(f));
      lines.push("");
    }
  }

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("## Secret hygiene findings");
  lines.push(
    "(Basic but essential; other tools can catch these if you install them.)"
  );
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");
  if (hygieneFindings.length === 0) {
    lines.push("(none)");
    lines.push("");
  } else {
    for (const f of sortBySeverity(hygieneFindings)) {
      lines.push(...renderFinding(f));
      lines.push("");
    }
  }

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("## Manual-check items");
  lines.push("(We couldn't confirm these from the repo alone.)");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");
  if (uncertains.length === 0) {
    lines.push("(none)");
    lines.push("");
  } else {
    for (const u of uncertains) {
      lines.push(`⚠️  ${u.check}: ${u.title}`);
      lines.push(`   File: ${u.file}`);
      if (u.body) {
        for (const ln of u.body.split("\n")) lines.push(`   ${ln}`);
      }
      lines.push(`   What to check: ${u.whatToCheck}`);
      lines.push("");
    }
  }

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("## Clean / Not applicable");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");
  if (clean.length === 0) {
    lines.push("(nothing to report)");
    lines.push("");
  } else {
    // Sort clean items by check ID for stable output
    const sortedClean = [...clean].sort((a, b) =>
      a.check.localeCompare(b.check)
    );
    for (const c of sortedClean) {
      lines.push(`${c.icon} ${c.check}: ${c.note}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("## Summary");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");

  const byLevel = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) byLevel[f.severity]++;

  lines.push(
    `${byLevel.CRITICAL} critical • ${byLevel.HIGH} high • ${byLevel.LOW} low • ${uncertains.length} manual-check • ${testFileMatches} test-file matches • ${suppressed.length} user-suppressed`
  );
  lines.push("");

  const total = findings.length;
  if (total > 0 || (deployGate && uncertains.length > 0)) {
    lines.push(
      `⚠️  DO NOT DEPLOY — ${total} finding${total === 1 ? "" : "s"} must be resolved.`
    );
    lines.push("PREDEPLOY-AUDIT-RESULT: BLOCKED");
  } else {
    lines.push("✅ No issues found. Ready to deploy.");
    lines.push("PREDEPLOY-AUDIT-RESULT: CLEAN");
  }

  return lines.join("\n");
}

function renderFinding(f) {
  const icon =
    f.severity === "CRITICAL"
      ? "🟥"
      : f.severity === "HIGH"
      ? "🟧"
      : f.severity === "LOW"
      ? "🟦"
      : "⬜";
  const out = [];
  out.push(`${icon} ${f.severity} — ${f.check}: ${f.title}`);
  if (f.file) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    out.push(`   File: ${loc}`);
  }
  if (f.body) {
    for (const line of f.body.split("\n")) out.push(`   ${line}`);
  }
  if (f.fix) {
    const fixLines = f.fix.split("\n");
    out.push(`   Fix: ${fixLines[0]}`);
    for (const l of fixLines.slice(1)) out.push(`        ${l}`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

function runAllChecks(ctx) {
  const results = makeResults();

  checkC1_trackedEnvFiles(ctx, results);
  const c1Hits = results.findings
    .filter((f) => f.check === "C1")
    .map((f) => f.file);
  checkC2_envInGitHistory(ctx, results, c1Hits);
  checkC3_hardcodedSecrets(ctx, results);
  checkC4_nextPublicSecrets(ctx, results);
  checkC5_supabaseServiceRoleInClient(ctx, results);
  checkC6_stripeWebhookVerification(ctx, results);
  checkC7_supabaseRlsMissing(ctx, results);
  checkC8_nextVersion(ctx, results);
  checkC9_remotePatternsWildcard(ctx, results);

  return results;
}

// ─────────────────────────────────────────────────────────────────────
// §C1 — Tracked .env* files
// ─────────────────────────────────────────────────────────────────────

const ENV_INCLUDE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.staging",
  ".env.test",
  ".env.test.local"
]);

const ENV_EXCLUDE_BASENAMES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
  ".env.schema"
]);

function checkC1_trackedEnvFiles(ctx, results) {
  if (!ctx.isGit) {
    results.clean.push({
      check: "C1",
      icon: "➖",
      note: "not a git repo — skipped"
    });
    return;
  }

  const hits = [];
  for (const f of ctx.trackedFiles) {
    const base = path.basename(f);
    if (ENV_INCLUDE_BASENAMES.has(base) && !ENV_EXCLUDE_BASENAMES.has(base)) {
      const parts = f.split("/");
      if (parts.some((p) => EXCLUDE_DIRS.has(p))) continue;
      hits.push(f);
    }
  }

  if (hits.length === 0) {
    results.clean.push({
      check: "C1",
      icon: "✅",
      note: ".env files — clean"
    });
    return;
  }

  for (const f of hits) {
    results.findings.push({
      check: "C1",
      ownership: "PACKAGE",
      section: "hygiene",
      severity: "CRITICAL",
      title: ".env file tracked in git",
      file: f,
      line: null,
      body:
        "This file is visible to anyone with repo access (collaborators,\n" +
        "all forks, every past and future clone). Treat every secret in\n" +
        "it as leaked.",
      fix:
        `git rm --cached ${f}\n` +
        `echo "${f}" >> .gitignore\n` +
        "Then rotate every key currently in this file.\n" +
        "Also review finding C2 — history may still contain it."
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C2 — .env* in git history
// ─────────────────────────────────────────────────────────────────────

function checkC2_envInGitHistory(ctx, results, c1Hits) {
  if (!ctx.isGit) {
    results.clean.push({
      check: "C2",
      icon: "➖",
      note: "not a git repo — skipped"
    });
    return;
  }

  let out;
  let capped = false;
  try {
    out = execFileSync(
      "git",
      [
        "log",
        "--all",
        "--full-history",
        "--diff-filter=A",
        "--name-only",
        "--format=%H %ci",
        "-n",
        "10000",
        "--",
        ".env",
        ".env.*",
        "**/.env",
        "**/.env.*"
      ],
      {
        cwd: ctx.repo,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    const commitCount = (
      execFileSync("git", ["rev-list", "--all", "--count"], {
        cwd: ctx.repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }) || "0"
    ).trim();
    if (parseInt(commitCount, 10) > 10000) capped = true;
  } catch {
    results.clean.push({
      check: "C2",
      icon: "➖",
      note: ".env history — could not read git log"
    });
    return;
  }

  // git log --diff-filter=A --name-only --format='%H %ci' produces:
  //   <SHA> <DATE>
  //   <blank>
  //   <file>
  //   <file>
  //   <blank>
  //   <SHA> <DATE>
  //   ...
  // We walk lines linearly, tracking the most recently seen header.
  const firstAddedByFile = new Map();
  let curSha = null;
  let curDate = null;
  for (const rawLine of out.split("\n")) {
    if (rawLine === "") continue;
    const header = rawLine.match(/^([0-9a-f]{7,})\s+(.+)$/);
    if (header) {
      curSha = header[1];
      curDate = header[2];
      continue;
    }
    if (!curSha) continue;
    const p = rawLine;
    const base = path.basename(p);
    if (!ENV_INCLUDE_BASENAMES.has(base)) continue;
    if (ENV_EXCLUDE_BASENAMES.has(base)) continue;
    if (!firstAddedByFile.has(p)) {
      firstAddedByFile.set(p, { sha: curSha, date: curDate });
    }
  }

  // §C2 step 3 dedup: skip files currently tracked (already in C1)
  const hits = [];
  for (const [p, meta] of firstAddedByFile.entries()) {
    if (c1Hits.includes(p)) continue;
    hits.push({ path: p, ...meta });
  }

  if (hits.length === 0) {
    const suffix = capped
      ? " (capped at 10,000 commits — run TruffleHog for deeper coverage)"
      : c1Hits.length > 0
      ? " (deduped against C1)"
      : "";
    results.clean.push({
      check: "C2",
      icon: "✅",
      note: `.env in git history — clean${suffix}`
    });
    return;
  }

  for (const h of hits) {
    results.findings.push({
      check: "C2",
      ownership: "PACKAGE",
      section: "hygiene",
      severity: "CRITICAL",
      title: ".env file present in git history (not in HEAD)",
      file: h.path,
      line: null,
      body:
        `First added in commit ${h.sha.slice(0, 7)} (${h.date}).\n` +
        "Every secret this file ever contained is permanently in git\n" +
        "history. Anyone who cloned or forked the repo still has them —\n" +
        "rewriting history does NOT help them.",
      fix:
        "Rotate every secret that was ever in this file.\n" +
        "(Optional secondary) git-filter-repo to rewrite history."
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C3 — Hardcoded known-format secrets in source
// ─────────────────────────────────────────────────────────────────────

// File enumeration for C3. Prefers git tracked files when available;
// falls back to a filesystem walk when the target is not a git repo.
// The fallback is what makes C3 trustworthy outside git contexts —
// without it, a non-git directory would silently produce zero findings
// even on hardcoded sk_live_/sk-proj-/whsec_ keys.
function collectC3ScanTargets(ctx) {
  const out = [];

  function shouldScan(relPath) {
    const base = path.basename(relPath);
    const ext = path.extname(relPath);
    if (
      base === "package-lock.json" ||
      base === "pnpm-lock.yaml" ||
      base === "yarn.lock" ||
      base === "bun.lockb"
    ) {
      return false;
    }
    // Skip top-level docs that describe the scanner (they contain
    // example format strings as part of the regression contract).
    if (
      /^(EXPECTED_FINDINGS|README)\.md$/i.test(base) &&
      relPath === base
    ) {
      return false;
    }
    if (/^\.env(\..*)?$/.test(base)) {
      return !ENV_EXCLUDE_BASENAMES.has(base);
    }
    return (
      SCAN_EXTS.has(ext) ||
      ext === ".json" ||
      ext === ".yml" ||
      ext === ".yaml" ||
      ext === ".toml"
    );
  }

  if (ctx.isGit) {
    for (const f of ctx.trackedFiles) {
      if (shouldScan(f)) out.push(f);
    }
    return out;
  }

  // Fallback: walk the filesystem.
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const relChild = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        walk(full, relChild);
      } else if (e.isFile()) {
        if (shouldScan(relChild)) out.push(relChild);
      }
    }
  }
  walk(ctx.repo, "");
  return out;
}

function checkC3_hardcodedSecrets(ctx, results) {
  const scanTargets = collectC3ScanTargets(ctx);

  const hits = [];
  let testHits = 0;
  const MAX_FILES = 5000;
  let scanned = 0;

  for (const rel of scanTargets) {
    if (scanned++ >= MAX_FILES) break;
    let content;
    try {
      const stat = fs.statSync(path.join(ctx.repo, rel));
      if (stat.size > 1024 * 1024) continue;
      content = fs.readFileSync(path.join(ctx.repo, rel), "utf8");
    } catch {
      continue;
    }

    const baseName = path.basename(rel);
    const isEnvFile = /^\.env(\..*)?$/.test(baseName);

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (lineHasPlaceholder(line)) continue;
      const m = matchSecretFormat(line);
      if (!m) continue;

      // C3/C4 dedup: in .env files, if the line is a public-prefixed
      // assignment, C4 owns the finding (it gives the rename+rotate
      // instruction). C3 stays silent for that line so the user sees
      // exactly one finding per mistake.
      if (isEnvFile) {
        const trimmed = line.trim();
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          if (/^(NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)/.test(key)) {
            continue;
          }
        }
      }

      const suppressed = findSuppressionOnLine(content, i + 1);
      if (suppressed) {
        results.suppressed.push({
          check: "C3",
          file: rel,
          line: i + 1,
          reason: suppressed
        });
        continue;
      }
      if (isTestFile(rel)) {
        testHits++;
        continue;
      }
      hits.push({
        file: rel,
        line: i + 1,
        match: m.match,
        format: m.format
      });
    }
  }

  results.testFileMatches += testHits;

  if (hits.length === 0) {
    results.clean.push({
      check: "C3",
      icon: "✅",
      note: `hardcoded known-format secrets — clean${
        testHits > 0 ? ` (${testHits} test-file match(es) suppressed)` : ""
      }`
    });
    return;
  }

  for (const h of hits) {
    results.findings.push({
      check: "C3",
      ownership: "PACKAGE",
      section: "hygiene",
      severity: "CRITICAL",
      title: `Hardcoded ${h.format.label} in tracked source`,
      file: h.file,
      line: h.line,
      body:
        `Format: ${h.format.label}\n` +
        "This key is in a tracked file — treat it as publicly leaked.",
      fix:
        `Rotate this key immediately at ${h.format.rotateUrl}\n` +
        "Then move it to a server-only environment variable and never commit it."
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C4 — NEXT_PUBLIC_* / VITE_* / REACT_APP_* with secret-shaped values
// ─────────────────────────────────────────────────────────────────────

const C4_NAME_ALLOWLIST_SUBSTRINGS = [
  "PUBLISHABLE",
  "ANON",
  "PUBLIC_KEY",
  "CLIENT_ID",
  "URL",
  "HOST",
  "DOMAIN",
  "ENDPOINT",
  "APP_ID"
];

const C4_NAME_SECRET_SUBSTRINGS = [
  "SECRET",
  "PRIVATE",
  "SERVICE_ROLE",
  "API_KEY",
  "WEBHOOK_SECRET",
  "AUTH_SECRET",
  "SIGNING_SECRET",
  "PASSWORD",
  "TOKEN"
];

function checkC4_nextPublicSecrets(ctx, results) {
  const envFiles = readEnvFilesRecursive(ctx.repo);
  const hits = [];

  for (const ef of envFiles) {
    const base = path.basename(ef.relPath);
    if (ENV_EXCLUDE_BASENAMES.has(base)) continue;

    for (let i = 0; i < ef.lines.length; i++) {
      const raw = ef.lines[i];
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!/^(NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)/.test(key)) continue;

      const allowlisted = C4_NAME_ALLOWLIST_SUBSTRINGS.some((s) =>
        key.includes(s)
      );

      const nameSuspicious =
        !allowlisted &&
        C4_NAME_SECRET_SUBSTRINGS.some((s) => key.includes(s));

      const valueMatch = matchSecretFormat(value);
      const valueSuspicious = !!valueMatch && !lineHasPlaceholder(value);

      if (!nameSuspicious && !valueSuspicious) continue;
      if (allowlisted && !valueSuspicious) continue;

      const reasons = [];
      if (nameSuspicious) reasons.push("name contains secret indicator");
      if (valueSuspicious)
        reasons.push(`value matches ${valueMatch.format.label} format`);

      hits.push({
        file: ef.relPath,
        line: i + 1,
        key,
        reasons
      });
    }
  }

  if (hits.length === 0) {
    results.clean.push({
      check: "C4",
      icon: "✅",
      note: "NEXT_PUBLIC_* secret exposure — clean"
    });
    return;
  }

  for (const h of hits) {
    results.findings.push({
      check: "C4",
      ownership: "OWN",
      section: "framework",
      severity: "CRITICAL",
      title: "Client-exposed secret variable",
      file: h.file,
      line: h.line,
      body:
        `Variable: ${h.key}\n` +
        `Reason: ${h.reasons.join("; ")}\n` +
        "Any variable with a NEXT_PUBLIC_ / VITE_ / REACT_APP_ prefix is\n" +
        "embedded into the client JavaScript bundle at build time and\n" +
        "visible to anyone who opens DevTools.",
      fix:
        "Drop the public prefix (e.g. rename to OPENAI_API_KEY), move\n" +
        "all usage to server actions or route handlers, and rotate the key."
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C5 — Supabase service-role key in client-reachable code
// ─────────────────────────────────────────────────────────────────────

const C5_PATTERNS = [
  /\bSUPABASE_SERVICE_ROLE_KEY\b/,
  /\bSUPABASE_SERVICE_KEY\b/,
  /\bSERVICE_ROLE_KEY\b/,
  /\bserviceRoleKey\b/
];

function checkC5_supabaseServiceRoleInClient(ctx, results) {
  if (!ctx.supabaseDetected) {
    results.clean.push({
      check: "C5",
      icon: "➖",
      note: "not applicable (no Supabase client detected)"
    });
    return;
  }

  const sourceFiles = getSourceFiles(ctx);
  const findings = [];
  const uncertains = [];

  for (const rel of sourceFiles) {
    let content;
    try {
      content = fs.readFileSync(path.join(ctx.repo, rel), "utf8");
    } catch {
      continue;
    }

    // Phase 2 §C5 anti-FP: strip comments and string literals first
    const stripped = stripCommentsAndStrings(content);
    let matched = false;
    for (const re of C5_PATTERNS) {
      if (re.test(stripped)) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;

    // Find a line number for the report by scanning the *stripped*
    // content. Walk both the original and stripped versions in parallel
    // wouldn't be reliable; instead, we re-scan original lines and only
    // accept matches whose line is not entirely a comment.
    let matchLine = 0;
    const origLines = content.split("\n");
    let inBlock = false;
    for (let i = 0; i < origLines.length; i++) {
      const line = origLines[i];
      const trimmed = line.trim();
      // Track block comments crudely
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        continue;
      }
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
        inBlock = true;
        continue;
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      // Strip line comment portion
      const lineNoComment = line.split("//")[0];
      let lineMatched = false;
      for (const re of C5_PATTERNS) {
        if (re.test(lineNoComment)) {
          lineMatched = true;
          break;
        }
      }
      if (lineMatched) {
        matchLine = i + 1;
        break;
      }
    }
    if (matchLine === 0) {
      // Stripped content matched but no per-line match found above.
      // Could happen if the only match was inside a string literal that
      // we stripped — fall through and emit nothing (consistent with
      // anti-FP intent).
      continue;
    }

    const suppressed = findSuppressionOnLine(content, matchLine);
    if (suppressed) {
      results.suppressed.push({
        check: "C5",
        file: rel,
        line: matchLine,
        reason: suppressed
      });
      continue;
    }

    const cls = classifyFile(ctx.repo, rel);
    if (cls === "server-only") continue;
    if (cls === "client-reachable") {
      findings.push({ file: rel, line: matchLine });
    } else {
      uncertains.push({ file: rel, line: matchLine });
    }
  }

  for (const f of findings) {
    results.findings.push({
      check: "C5",
      ownership: "OWN",
      section: "framework",
      severity: "CRITICAL",
      title: "Supabase service-role key in client-reachable code",
      file: f.file,
      line: f.line,
      body:
        'This file is classified as client-reachable (explicit "use client"\n' +
        "directive or Pages Router page). Any env var referenced here is\n" +
        "embedded into the client JavaScript bundle. The service-role key\n" +
        "bypasses ALL Supabase Row-Level Security — visitors to your site\n" +
        "can query or modify every row in your database.",
      fix:
        "Move service-role usage into server-only code (route handlers,\n" +
        "server actions, middleware). Client code must use the anon key\n" +
        "with RLS policies (see check C7)."
    });
  }
  for (const u of uncertains) {
    results.uncertains.push({
      check: "C5",
      title: "Could not verify safety of Supabase service-role reference",
      file: u.file,
      body:
        "This file references the service-role key but lives in an\n" +
        'ambiguous location (e.g. lib/ or components/ without a "use server"\n' +
        'or "use client" directive).',
      whatToCheck:
        "confirm this file is only imported from server code, then add\n" +
        "      // @predeploy-ignore: server-only-wrapper\n" +
        "      on the matching line. If it is imported from any client\n" +
        "      component, that's a CRITICAL issue — move the service-role\n" +
        "      usage to a route handler or server action."
    });
  }

  if (findings.length === 0 && uncertains.length === 0) {
    results.clean.push({
      check: "C5",
      icon: "✅",
      note: "Supabase service-role key in client code — clean"
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C6 — Stripe webhook signature verification missing
// ─────────────────────────────────────────────────────────────────────

const C6_PATH_PATTERNS = [
  /^app\/.*webhook.*\/route\.(ts|js|mjs|cjs)$/i,
  /^app\/.*\/webhooks\/stripe.*\/route\.(ts|js|mjs|cjs)$/i,
  /^app\/.*\/stripe\/.*\/route\.(ts|js|mjs|cjs)$/i,
  /^app\/api\/stripe\/webhook\/route\.(ts|js|mjs|cjs)$/i,
  /^pages\/api\/.*stripe.*\.(ts|js|mjs|cjs)$/i,
  /^pages\/api\/.*webhook.*\.(ts|js|mjs|cjs)$/i
];

function isC6Candidate(relPath) {
  return C6_PATH_PATTERNS.some((re) => re.test(relPath));
}

function checkC6_stripeWebhookVerification(ctx, results) {
  const sourceFiles = getSourceFiles(ctx);
  const candidates = sourceFiles.filter(isC6Candidate);

  if (candidates.length === 0) {
    results.clean.push({
      check: "C6",
      icon: "➖",
      note: "not applicable (no Stripe webhook files detected)"
    });
    return;
  }

  const findings = [];
  const uncertains = [];

  for (const rel of candidates) {
    let content;
    try {
      content = fs.readFileSync(path.join(ctx.repo, rel), "utf8");
    } catch {
      continue;
    }

    const stripped = stripCommentsAndStrings(content);

    const importsStripe =
      /\bimport\s+[^;]*\bfrom\s*$/.test(stripped) || // never matches alone
      /\bimport\s+[^;]*from\s+stripe\b/.test(stripped) ||
      /\brequire\(\s*stripe\s*\)/.test(stripped);
    // The above is awkward because we stripped strings. Re-check using
    // the original content but only looking at non-comment lines.
    let stripeImported = false;
    let bodyRead = false;
    let constructEventCalled = false;
    const origLines = content.split("\n");
    let inBlock = false;
    for (let i = 0; i < origLines.length; i++) {
      const line = origLines[i];
      const trimmed = line.trim();
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        continue;
      }
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
        inBlock = true;
        continue;
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const code = line.split("//")[0];
      if (
        /\bimport\s+[^;]*from\s+['"]stripe['"]/.test(code) ||
        /\brequire\(\s*['"]stripe['"]\s*\)/.test(code)
      )
        stripeImported = true;
      if (
        /\brequest\.text\s*\(/.test(code) ||
        /\breq\.text\s*\(/.test(code) ||
        /\brequest\.arrayBuffer\s*\(/.test(code) ||
        /\breq\.arrayBuffer\s*\(/.test(code) ||
        /\breq\.rawBody\b/.test(code) ||
        /\breq\.body\b/.test(code)
      )
        bodyRead = true;
      if (/\bconstructEvent(Async)?\s*\(/.test(code))
        constructEventCalled = true;
    }

    void importsStripe; // unused — kept to make intent clear
    void stripped;

    if (!stripeImported) continue;
    if (!bodyRead) continue;

    const suppression = content.match(/@predeploy-ignore:\s*([^\n]+)/);
    if (suppression) {
      results.suppressed.push({
        check: "C6",
        file: rel,
        line: null,
        reason: suppression[1].trim()
      });
      continue;
    }

    if (constructEventCalled) continue;

    // §C6 one-level helper resolution
    const helperResolved = tryResolveC6HelperVerification(
      ctx.repo,
      rel,
      content
    );
    if (helperResolved === "safe") continue;
    if (helperResolved === "unresolved") {
      uncertains.push({ file: rel });
      continue;
    }

    findings.push({ file: rel });
  }

  for (const f of findings) {
    results.findings.push({
      check: "C6",
      ownership: "OWN",
      section: "framework",
      severity: "CRITICAL",
      title: "Stripe webhook handler missing signature verification",
      file: f.file,
      line: null,
      body:
        "This handler imports stripe and reads the raw request body,\n" +
        "but never calls stripe.webhooks.constructEvent(). Any HTTP\n" +
        "client can POST a forged event to this endpoint and it will\n" +
        "be processed as if it came from Stripe. Mirrors CVE-2026-21894.",
      fix:
        "Add signature verification BEFORE processing the body:\n" +
        "  const sig = request.headers.get('stripe-signature');\n" +
        "  const rawBody = await request.text();\n" +
        "  const event = stripe.webhooks.constructEvent(\n" +
        "    rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET\n" +
        "  );"
    });
  }
  for (const u of uncertains) {
    results.uncertains.push({
      check: "C6",
      title: "Could not resolve Stripe verification in transitively-imported helper",
      file: u.file,
      body:
        "This file imports stripe and reads the raw body. It does not\n" +
        "call constructEvent directly, and we could not follow the\n" +
        "helper import chain deep enough to confirm verification is done.",
      whatToCheck:
        "trace every helper call in this file — at least one must\n" +
        "      ultimately call stripe.webhooks.constructEvent(...) with the\n" +
        "      raw body and signature header."
    });
  }

  if (findings.length === 0 && uncertains.length === 0) {
    results.clean.push({
      check: "C6",
      icon: "✅",
      note: "Stripe webhook signature verification — clean"
    });
  }
}

function tryResolveC6HelperVerification(repoRoot, callerRel, content) {
  const importRe =
    /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  let sawCandidate = false;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];
    if (
      !spec.startsWith(".") &&
      !spec.startsWith("@/") &&
      !spec.startsWith("~/") &&
      !spec.startsWith("src/") &&
      !spec.startsWith("lib/")
    ) {
      continue;
    }
    sawCandidate = true;
    const resolved = resolveLocalImport(repoRoot, callerRel, spec);
    if (!resolved) continue;
    try {
      const helperContent = fs.readFileSync(resolved, "utf8");
      if (/\bconstructEvent(Async)?\s*\(/.test(helperContent)) {
        return "safe";
      }
    } catch {}
  }
  return sawCandidate ? "unresolved" : "finding";
}

function resolveLocalImport(repoRoot, callerRel, spec) {
  let basePath;
  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    basePath = path.join(repoRoot, spec.slice(2));
  } else if (spec.startsWith(".")) {
    basePath = path.resolve(path.dirname(path.join(repoRoot, callerRel)), spec);
  } else if (spec.startsWith("src/") || spec.startsWith("lib/")) {
    basePath = path.join(repoRoot, spec);
  } else {
    return null;
  }
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  for (const ext of exts) {
    if (fs.existsSync(basePath + ext)) return basePath + ext;
  }
  for (const ext of exts) {
    const idx = path.join(basePath, "index" + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// §C7 — Supabase RLS missing in schema
// ─────────────────────────────────────────────────────────────────────

function checkC7_supabaseRlsMissing(ctx, results) {
  if (!ctx.supabaseDetected) {
    results.clean.push({
      check: "C7",
      icon: "➖",
      note: "not applicable (no Supabase client detected)"
    });
    return;
  }

  const migDir = path.join(ctx.repo, "supabase", "migrations");
  const miscFiles = [
    path.join(ctx.repo, "supabase", "seed.sql"),
    path.join(ctx.repo, "schema.sql"),
    path.join(ctx.repo, "database.sql")
  ].filter((f) => fs.existsSync(f));

  let migFiles = [];
  if (fs.existsSync(migDir) && fs.statSync(migDir).isDirectory()) {
    migFiles = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => path.join(migDir, f));
  }

  const allSqlFiles = [...migFiles, ...miscFiles];

  if (allSqlFiles.length === 0) {
    results.uncertains.push({
      check: "C7",
      title: "Supabase client detected but no migrations found in repo",
      file: "supabase/migrations/",
      body: "Without migrations in the repo we can't verify RLS coverage.",
      whatToCheck:
        "in the Supabase dashboard (Database → Tables), confirm every\n" +
        '      public table shows "RLS enabled". Pay particular attention\n' +
        "      to auth-adjacent tables (profiles, users, password_reset_tokens)."
    });
    return;
  }

  const createdTables = [];
  const enabledTables = new Set();
  const disabledTables = [];
  let parseUncertain = false;
  const uncertainFiles = [];

  for (const f of allSqlFiles) {
    let content;
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }

    if (
      /\$\$/.test(content) ||
      /^\s*DO\s+/im.test(content) ||
      content.split("\n").length > 2000
    ) {
      parseUncertain = true;
      uncertainFiles.push(path.relative(ctx.repo, f));
    }

    const sanitized = content.replace(/\$\$[\s\S]*?\$\$/g, "");

    const createRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"?public"?\.)?(?:"([^"]+)"|(\w+)))/gi;
    let m;
    while ((m = createRe.exec(sanitized)) !== null) {
      const name = m[1] || m[2];
      if (!name) continue;
      const before = sanitized.slice(0, m.index);
      const line = before.split("\n").length;
      const prefix = sanitized.slice(Math.max(0, m.index - 40), m.index);
      if (/\b(auth|storage|extensions|supabase_\w+)\.\s*$/i.test(prefix))
        continue;
      createdTables.push({
        schema: "public",
        name,
        file: path.relative(ctx.repo, f),
        line
      });
    }

    const enableRe =
      /ALTER\s+TABLE\s+(?:(?:"?public"?\.)?(?:"([^"]+)"|(\w+)))\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((m = enableRe.exec(sanitized)) !== null) {
      const name = m[1] || m[2];
      if (name) enabledTables.add(`public.${name}`);
    }

    const disableRe =
      /ALTER\s+TABLE\s+(?:(?:"?public"?\.)?(?:"([^"]+)"|(\w+)))\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((m = disableRe.exec(sanitized)) !== null) {
      const name = m[1] || m[2];
      if (!name) continue;
      const before = sanitized.slice(0, m.index);
      const line = before.split("\n").length;
      disabledTables.push({
        schema: "public",
        name,
        file: path.relative(ctx.repo, f),
        line
      });
    }
  }

  const missing = createdTables.filter(
    (t) => !enabledTables.has(`public.${t.name}`)
  );

  if (missing.length === 0 && disabledTables.length === 0) {
    if (parseUncertain) {
      results.uncertains.push({
        check: "C7",
        title: "Could not fully verify Supabase RLS coverage",
        file: uncertainFiles.join(", "),
        body:
          "Some migration files contained SQL we could not fully parse\n" +
          "(dollar-quoted blocks, DO blocks, or >2000 lines).",
        whatToCheck:
          "for every public table in your Supabase dashboard, confirm\n" +
          "      RLS is enabled."
      });
    } else {
      results.clean.push({
        check: "C7",
        icon: "✅",
        note: "Supabase RLS — clean"
      });
    }
    return;
  }

  for (const t of missing) {
    results.findings.push({
      check: "C7",
      ownership: "OWN",
      section: "framework",
      severity: "CRITICAL",
      title: "Supabase table created without Row-Level Security",
      file: t.file,
      line: t.line,
      body:
        `Table: public.${t.name}\n` +
        "Without RLS, this table is fully readable and writable via the\n" +
        "Supabase anon key from any internet visitor. Mirrors CVE-2025-48757.",
      fix:
        `ALTER TABLE public.${t.name} ENABLE ROW LEVEL SECURITY;\n` +
        "Then add policies defining who may read/write what."
    });
  }
  for (const t of disabledTables) {
    results.findings.push({
      check: "C7",
      ownership: "OWN",
      section: "framework",
      severity: "CRITICAL",
      title: "Supabase table has RLS explicitly disabled",
      file: t.file,
      line: t.line,
      body:
        `Table: public.${t.name}\n` +
        "DISABLE ROW LEVEL SECURITY was used — any visitor with the anon\n" +
        "key can query or modify every row in this table.",
      fix:
        `ALTER TABLE public.${t.name} ENABLE ROW LEVEL SECURITY;\n` +
        "Add policies for the intended access patterns."
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C8 — Vulnerable Next.js version with host-platform framing
// ─────────────────────────────────────────────────────────────────────

const NEXT_VULN_RANGES = [
  {
    cve: "CVE-2025-29927",
    description: "Middleware authorization bypass",
    cvss: "9.1",
    epss: "92.56",
    ranges: [
      { lt: "12.3.5" },
      { gte: "13.0.0", lt: "13.5.9" },
      { gte: "14.0.0", lt: "14.2.25" },
      { gte: "15.0.0", lt: "15.2.3" }
    ],
    fixedAt: "14.2.25 / 15.2.3",
    vercelAutoPatches: true,
    ref: "https://nvd.nist.gov/vuln/detail/CVE-2025-29927"
  },
  {
    cve: "CVE-2024-34351",
    description: "Server Actions SSRF / Image SSRF",
    cvss: "7.5",
    epss: null,
    ranges: [{ lt: "14.1.1" }],
    fixedAt: "14.1.1",
    vercelAutoPatches: false,
    ref: "https://www.miggo.io/vulnerability-database/cve/CVE-2024-34351"
  }
];

function cmpSemver(a, b) {
  const pa = a.split("-")[0].split(".").map((x) => parseInt(x, 10));
  const pb = b.split("-")[0].split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function matchesRange(version, range) {
  if (range.lt && cmpSemver(version, range.lt) >= 0) return false;
  if (range.gte && cmpSemver(version, range.gte) < 0) return false;
  return true;
}

function checkC8_nextVersion(ctx, results) {
  if (!ctx.nextDetected) {
    results.clean.push({
      check: "C8",
      icon: "➖",
      note: "not applicable (Next.js not installed)"
    });
    return;
  }
  if (!ctx.nextVersion) {
    results.uncertains.push({
      check: "C8",
      title: "Could not resolve installed Next.js version",
      file: "package.json",
      body:
        "next is declared in package.json but we could not read the\n" +
        "installed version from the lockfile or node_modules.",
      whatToCheck:
        "run `npm ls next` (or your package manager equivalent) and\n" +
        "      confirm the version is at least 14.2.25 or 15.2.3."
    });
    return;
  }

  const version = ctx.nextVersion;
  let anyFinding = false;

  for (const v of NEXT_VULN_RANGES) {
    const vuln = v.ranges.some((r) => matchesRange(version, r));
    if (!vuln) continue;

    let severity;
    let hostBlurb;
    if (v.vercelAutoPatches && ctx.host === "vercel") {
      severity = "LOW";
      hostBlurb =
        "Detected host: Vercel (via vercel.json).\n" +
        "Vercel auto-patches this at the platform level, so your hosted\n" +
        "deployment is protected — still recommended to upgrade.";
    } else if (v.vercelAutoPatches && ctx.host === "unknown") {
      severity = "HIGH";
      hostBlurb =
        "Detected host: could not determine.\n" +
        "Impact depends on host:\n" +
        "  • If deployed to Vercel: auto-patched (LOW)\n" +
        "  • Elsewhere (Railway, Fly.io, Docker, Netlify, Render, self-hosted): CRITICAL";
    } else if (v.vercelAutoPatches) {
      severity = "CRITICAL";
      hostBlurb =
        `Detected host: ${ctx.host}.\n` +
        "This host does NOT auto-patch Next.js — your deployment is\n" +
        "directly exploitable until you upgrade.";
    } else {
      severity = "HIGH";
      hostBlurb = `Detected host: ${ctx.host}.`;
    }

    anyFinding = true;
    results.findings.push({
      check: "C8",
      ownership: "PACKAGE",
      section: "framework",
      severity,
      title: `Next.js ${version} vulnerable to ${v.cve} (${v.description})`,
      file: "package.json",
      line: null,
      body:
        `Installed: next@${version}\n` +
        `Fixed in: ${v.fixedAt}\n` +
        (v.cvss ? `CVSS: ${v.cvss}${v.epss ? ` (EPSS ${v.epss})` : ""}\n` : "") +
        hostBlurb +
        `\nRef: ${v.ref}`,
      fix: `Upgrade next to ${v.fixedAt} or later.`
    });
  }

  if (!anyFinding) {
    results.clean.push({
      check: "C8",
      icon: "✅",
      note: `Next.js version — clean (next@${version})`
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// §C9 — remotePatterns wildcard in next.config
// ─────────────────────────────────────────────────────────────────────

function checkC9_remotePatternsWildcard(ctx, results) {
  const candidates = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs"
  ];
  let configPath = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(ctx.repo, c))) {
      configPath = c;
      break;
    }
  }

  if (!configPath) {
    results.clean.push({
      check: "C9",
      icon: "➖",
      note: "not applicable (no next.config detected)"
    });
    return;
  }

  let content;
  try {
    content = fs.readFileSync(path.join(ctx.repo, configPath), "utf8");
  } catch {
    results.clean.push({
      check: "C9",
      icon: "➖",
      note: "could not read next.config"
    });
    return;
  }

  const lines = content.split("\n");
  const findings = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlock = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    const code = line.split("//")[0];

    if (/hostname\s*:\s*["'](\*\*|\*)["']/.test(code)) {
      const suppressed = findSuppressionOnLine(content, i + 1);
      if (suppressed) {
        results.suppressed.push({
          check: "C9",
          file: configPath,
          line: i + 1,
          reason: suppressed
        });
        continue;
      }
      findings.push({ line: i + 1 });
    } else if (/domains\s*:\s*\[\s*["'](\*\*|\*)["']\s*\]/.test(code)) {
      findings.push({ line: i + 1 });
    }
  }

  if (findings.length === 0) {
    results.clean.push({
      check: "C9",
      icon: "✅",
      note: "remotePatterns wildcard — clean"
    });
    return;
  }

  for (const f of findings) {
    results.findings.push({
      check: "C9",
      ownership: "OWN",
      section: "framework",
      severity: "HIGH",
      title: "Unrestricted image remote hostnames",
      file: configPath,
      line: f.line,
      body:
        'Pattern: hostname wildcard ("*" or "**").\n' +
        "The Next.js image optimization endpoint (/_next/image?url=…)\n" +
        "will proxy requests to ANY external host — including internal\n" +
        "networks and cloud metadata endpoints (169.254.169.254). This\n" +
        "is the SSRF surface behind CVE-2024-34351.",
      fix:
        "Replace the wildcard with an explicit hostname allowlist, e.g.:\n" +
        "  remotePatterns: [\n" +
        "    { protocol: 'https', hostname: 'images.unsplash.com' }\n" +
        "  ]"
    });
  }
}

main();
