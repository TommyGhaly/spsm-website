#!/usr/bin/env node
/**
 * Copy the values CI needs out of `.env` and into GitHub Actions secrets.
 *
 * =============================================================================
 * ## Why this is a script and not a shell one-liner
 *
 * The one-liner was tried first and it silently did half the job:
 *
 *     grep -E '^(NEXT_PUBLIC_|ANNOUNCEMENTS_)' .env | while IFS='=' read -r k v; do
 *       gh secret set "$k" --body "$v"
 *     done
 *
 * `gh` inherits the loop's stdin, which is the pipe the loop is reading from —
 * so the first `gh` invocation that touches stdin consumed the rest of the
 * file. Twelve secrets landed, the thirteenth line was a 2371-character service
 * account, and everything after it — Square, Azure — was eaten. Nothing
 * errored. The only symptom was six missing secrets and a deploy that failed
 * later for what looked like an unrelated reason.
 *
 * That is the whole argument: this is a job with three quiet failure modes, and
 * a loop in a pipeline hides all of them.
 *
 *   1. **stdin.** Every child process here gets `stdin: 'ignore'`.
 *   2. **Quoting.** `.env` wraps the service-account JSON in single quotes.
 *      `--body "$v"` passes the quotes through as part of the value, so the
 *      secret is valid-looking and wrong. Quotes are stripped here.
 *   3. **Empty values.** `ANNOUNCEMENTS_DATABASE_ID=` is deliberately blank.
 *      Setting it creates an empty secret, which reads in a workflow exactly
 *      like a secret nobody has set — so it is skipped and reported, not set.
 *
 * ## It never prints a value
 *
 * Names and byte counts only. This runs in a terminal, terminals scroll back,
 * and scrollback gets pasted into issues.
 *
 * ## What it does not do
 *
 * `FIREBASE_SERVICE_ACCOUNT` is not in `.env` and is not created here: it is a
 * Google service-account key with deploy rights, and downloading one is a
 * console action taken by a person. See the report at the end.
 *
 * Usage:  node scripts/sync-ci-secrets.mjs [--dry-run]
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');

/**
 * Every secret the workflows read, gathered from the workflows themselves.
 *
 * Derived rather than listed, so a secret added to a workflow cannot be missed
 * here — which is the same argument `UNOFFERED_SCREENS` makes in
 * `features/access/areas.ts`: a flag no page can set is a flag only a console
 * edit can set. A name in a workflow and not in this list would be a secret nobody
 * ever set, discovered at deploy time.
 */
function secretsTheWorkflowsRead() {
  const names = new Set();
  for (const file of ['checks.yml', 'deploy.yml', 'refresh-archive.yml']) {
    let text;
    try {
      text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/secrets\.([A-Z0-9_]+)/g)) names.add(m[1]);
  }
  // Injected by GitHub itself; not ours to set.
  names.delete('GITHUB_TOKEN');
  return names;
}

/**
 * Parse `.env` the way a shell would, minus the shell.
 *
 * Only `KEY=value` on one line — which is every line in this file. A real
 * dotenv parser would also handle values spanning lines; this does not, and
 * asserts the shape instead so an unparsed line is reported rather than
 * silently skipped.
 */
function readEnvFile() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const values = new Map();
  raw.split('\n').forEach((line, index) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) {
      console.warn(`[secrets] line ${index + 1} is not KEY=value; skipped.`);
      return;
    }
    values.set(match[1], unquote(match[2]));
  });
  return values;
}

/** `'{"a":1}'` → `{"a":1}`. Only a *matching* pair, so an apostrophe survives. */
function unquote(value) {
  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

const wanted = secretsTheWorkflowsRead();
const env = readEnvFile();

const set = [];
const blank = [];
const absent = [];

for (const name of [...wanted].sort()) {
  const value = env.get(name);
  if (value === undefined) {
    absent.push(name);
    continue;
  }
  if (value === '') {
    blank.push(name);
    continue;
  }

  if (dryRun) {
    set.push([name, value.length]);
    continue;
  }

  /*
   * The value goes on **stdin**, not on argv.
   *
   * A 2371-character JSON key on an argv is a key in the process table and in
   * the shell's history; stdin is neither. `gh secret set` reads stdin whenever
   * `--body` is absent, which is the documented behaviour and is why no flag
   * says so here — `--body-file` does not exist in every `gh` version and using
   * it fails the whole run with a usage dump.
   *
   * `stdio` names all three streams explicitly so nothing inherits *this*
   * script's stdin either, which is the bug it exists because of.
   */
  const result = spawnSync('gh', ['secret', 'set', name], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`[secrets] gh failed for ${name} (exit ${result.status}).`);
    process.exitCode = 1;
    continue;
  }
  set.push([name, value.length]);
}

console.log('');
console.log(dryRun ? 'Would set from .env:' : 'Set from .env:');
for (const [name, size] of set) console.log(`  ${name.padEnd(44)} ${size} bytes`);

if (blank.length > 0) {
  console.log('');
  console.log('Blank in .env, so deliberately NOT set — an empty secret reads');
  console.log('in a workflow exactly like one nobody created:');
  for (const name of blank) console.log(`  ${name}`);
}

if (absent.length > 0) {
  console.log('');
  console.log('Read by a workflow and not in .env. These have to be added by hand:');
  for (const name of absent) {
    const why =
      name === 'FIREBASE_SERVICE_ACCOUNT'
        ? 'a Google service-account key JSON with Firebase Hosting Admin + Firebase Rules Admin'
        : 'no value on this machine';
    console.log(`  ${name.padEnd(44)} ${why}`);
  }
  console.log('');
  console.log('  gh secret set FIREBASE_SERVICE_ACCOUNT < /path/to/key.json');
}
