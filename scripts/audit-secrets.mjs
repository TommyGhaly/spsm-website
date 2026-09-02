#!/usr/bin/env node
/**
 * Prove that no credential has escaped .env.
 *
 * ---------------------------------------------------------------------------
 * Why this exists as a script rather than as a paragraph in a document.
 *
 * The arrangement this checks is already correct, and that is exactly the
 * problem: nothing about it is visible. `.env` is ignored by shape rather than
 * by name, the real tokens live in Secret Manager, Next inlines only
 * `NEXT_PUBLIC_*`, and the one service-account key the build reads is guarded by
 * a `typeof window` check inside the module that reads it. Every one of those is
 * a thing somebody could undo in a single line without noticing — a variable
 * renamed with the public prefix, a build-time module pulled into a client
 * component, a token pasted into a comment "just to test".
 *
 * So this does not read the policy. It reads the *values* in .env and looks for
 * them where they must never be: in anything git tracks, and in anything the
 * build produced. A leak is then a failing command rather than a discovery.
 *
 * **It never prints a secret.** Findings name the variable and the file. A
 * script that echoed the value it found would be the leak it was written to
 * catch — into a terminal, into a CI log, and into whatever archives that log.
 *
 *   npm run audit:secrets
 *
 * Exits non-zero on anything found, so it can be a pre-deploy gate.
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Everything a build could have written a credential into. */
const BUILD_OUTPUT = [
  'apps/website/out',
  'functions/lib',
  'functions/dist',
  'packages/shared/dist',
].filter((dir) => existsSync(resolve(ROOT, dir)));

/**
 * Shapes that are a credential wherever they appear.
 *
 * Independent of .env, so this still catches a token that was pasted straight
 * into a file and never went near the environment at all.
 */
const SHAPES = [
  ['a Square access token', /EAAA[A-Za-z0-9_-]{20,}/],
  ['a Square application secret', /sq0[a-z]{3}-[A-Za-z0-9_-]{15,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a Google API key', /AIza[0-9A-Za-z_-]{33}/],
  ['a Stripe live key', /sk_live_[0-9a-zA-Z]{10,}/],
  ['a webhook signing secret', /whsec_[0-9a-zA-Z]{20,}/],
  ['a GitHub token', /gh[pousr]_[0-9A-Za-z]{30,}/],
  ['an AWS access key id', /AKIA[0-9A-Z]{16}/],
];

/**
 * A variable whose *name* promises it is safe in a browser.
 *
 * Next inlines these into every page it exports, so one of them holding a real
 * credential is not a risk of a leak — it is a leak, already published. The
 * Firebase web config and the Square application id are genuinely public and
 * are allowed here by name; see the note at the top of .env.example.
 */
const PUBLIC_BY_DESIGN =
  /^NEXT_PUBLIC_(FIREBASE_|SQUARE_APPLICATION_ID|SQUARE_LOCATION_ID|SQUARE_ENVIRONMENT|AZURE_|TITHELY_)/;
const SECRET_SOUNDING = /(SECRET|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ACCOUNT|SIGNATURE|_API_KEY|_KEY|PASSWORD)$/;

/**
 * Which variables are credentials, taken from .env.example rather than guessed.
 *
 * ---------------------------------------------------------------------------
 * The first version of this decided from the *value*: anything longer than
 * twenty-four characters was treated as a secret and hunted for. That produced
 * two hundred findings on a clean repository, every one of them a project id or
 * a subdomain appearing in the source that legitimately names it — and a check
 * that cries wolf on a clean tree is a check that gets skipped on a dirty one.
 *
 * .env.example already answers this properly. It annotates each variable
 * `[secret]` or `[public]`, that annotation is the thing a person reads before
 * pasting a value in, and keeping the two in step costs nothing because they
 * sit four lines apart. A marker applies to every assignment under it until the
 * next blank line, which is how the file is already written.
 *
 * Unioned with the name pattern above, so a new `..._ACCESS_TOKEN` is covered
 * from the moment it exists rather than from the moment somebody remembers to
 * annotate it. Over-inclusion costs a few wasted greps; under-inclusion costs a
 * leaked credential, so the union is the right way round.
 * ---------------------------------------------------------------------------
 */
function annotatedSecrets() {
  const example = resolve(ROOT, '.env.example');
  if (!existsSync(example)) return new Set();

  const names = new Set();
  let marked = false;

  for (const line of readFileSync(example, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text) {
      marked = false;
      continue;
    }
    if (text.startsWith('#')) {
      if (text.includes('[secret]')) marked = true;
      else if (text.includes('[public]')) marked = false;
      continue;
    }
    const assignment = /^([A-Z0-9_]+)=/.exec(text);
    if (assignment && marked) names.add(assignment[1]);
  }

  return names;
}

const ANNOTATED = annotatedSecrets();
const isCredential = (name) => ANNOTATED.has(name) || SECRET_SOUNDING.test(name);

const findings = [];
const finding = (what, where, why) => findings.push({ what, where, why });

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Files containing a literal string, via `grep -rlF`.
 *
 * `-l` lists names rather than matching lines, which is not a convenience: a
 * matching line would contain the credential, and printing it is the thing this
 * script exists to prevent.
 */
function filesContaining(needle, paths) {
  if (!paths.length) return [];
  try {
    return execFileSync(
      'grep',
      ['-rlF', '--binary-files=without-match', '--', needle, ...paths],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    // grep exits 1 when it matches nothing, which is the answer we want.
    return [];
  }
}

/* ── 1. The ignore rules, checked against git rather than against .gitignore ── */

const MUST_NOT_BE_TRACKED = [
  '.env',
  '.env.local',
  '.env.production',
  'functions/.secret.local',
  'functions/.env.local',
  'serviceAccountKey.json',
];
const tracked = new Set(git(['ls-files']).split('\n').filter(Boolean));

for (const path of MUST_NOT_BE_TRACKED) {
  if (tracked.has(path)) {
    finding(
      path,
      path,
      'is tracked by git. It must not be — take it out of the index and rotate whatever is in it, ' +
        'because anything that has been committed has to be assumed to have been read.',
    );
  }
}

/* ── 2. Values from .env, looked for where they must never appear ─────────── */

const envPath = resolve(ROOT, '.env');
let checked = 0;

const trackedFiles = [...tracked].filter((file) => {
  const full = resolve(ROOT, file);
  return existsSync(full) && statSync(full).isFile();
});

if (!existsSync(envPath)) {
  console.warn('[audit] no .env here, so only the shape and prefix checks can run.');
} else {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;

    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');

    if (!value || value.startsWith('REPLACE_ME') || value === 'unset') continue;

    // A name that promises the browser may see it, holding something that
    // sounds like a credential.
    if (
      name.startsWith('NEXT_PUBLIC_') &&
      SECRET_SOUNDING.test(name) &&
      !PUBLIC_BY_DESIGN.test(name)
    ) {
      finding(
        name,
        '.env',
        'is prefixed NEXT_PUBLIC_, so Next inlines it into every exported page. ' +
          'If it is a credential, it is not at risk of being published — it is published.',
      );
    }

    if (name.startsWith('NEXT_PUBLIC_')) continue;

    /*
     * Only the credentials. A project id, a location id, a region and a
     * subdomain are all in this file too, they are all long, and every one of
     * them appears in the source that legitimately names it.
     */
    if (!isCredential(name)) continue;
    if (value.length < 12) continue;

    /*
     * A service-account key is a whole JSON document. Search for the private
     * key id inside it rather than the document: the document is reformatted on
     * its way anywhere it might leak to, while the id is both distinctive and
     * fatal on its own.
     */
    let needle = value;
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        needle = parsed.private_key_id ?? String(parsed.private_key ?? '').slice(40, 120);
      } catch {
        needle = '';
      }
    }
    if (!needle || needle.length < 24) continue;

    checked += 1;

    for (const where of filesContaining(needle, trackedFiles)) {
      finding(name, where, 'appears in a file git tracks.');
    }
    for (const where of filesContaining(needle, BUILD_OUTPUT)) {
      finding(
        name,
        where,
        'was written into the build output. Everything under there is served to the public.',
      );
    }
  }
}

/* ── 3. Credential shapes, anywhere in tracked source ─────────────────────── */

/**
 * What the shape scan skips, and why each one.
 *
 *   .env.example       every value in it is the literal word REPLACE_ME
 *   package-lock.json  integrity hashes are long base64 and match nothing real
 *   docs/              they describe the shapes; naming one is not holding one
 *   *.log *.map        build noise, not source
 */
const SKIP = /(^|\/)(package-lock\.json|\.env\.example)$|\.(log|map)$|^docs\//;

for (const file of trackedFiles) {
  if (SKIP.test(file)) continue;

  const full = resolve(ROOT, file);
  if (statSync(full).size > 4 * 1024 * 1024) continue;

  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    continue;
  }

  for (const [what, pattern] of SHAPES) {
    if (pattern.test(text)) {
      finding(
        what,
        file,
        'is committed as a literal. Rotate it first, then take it out of the file — ' +
          'and remember it is still in the history.',
      );
    }
  }
}

/* ── The report ───────────────────────────────────────────────────────────── */

if (findings.length === 0) {
  const output = BUILD_OUTPUT.length
    ? `and ${BUILD_OUTPUT.join(', ')}`
    : '(no build output present — build first for the fuller check)';
  console.log(
    '[audit] clean.\n' +
      `        ${checked} of ${ANNOTATED.size} annotated credential(s) in .env checked against ` +
      `${trackedFiles.length} tracked file(s) ${output}.\n` +
      `        ${SHAPES.length} credential shapes checked across tracked source.`,
  );
  process.exit(0);
}

console.error(`[audit] ${findings.length} problem(s). Values are deliberately not printed.\n`);
for (const { what, where, why } of findings) {
  console.error(`  ${what}\n    in ${where}\n    ${why}\n`);
}
process.exit(1);
