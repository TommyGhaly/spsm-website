/**
 * Compile-check firestore.rules and storage.rules against the running emulators.
 *
 * Why this exists: starting the emulators does NOT validate your rules. The
 * Firestore emulator boots happily with a syntax error in the file and only
 * complains when a request is evaluated — so "the emulator started" tells you
 * nothing. These endpoints run the actual rules compiler and return real
 * diagnostics with line numbers.
 *
 * This is a syntax/compile check, not a behavioural one. It cannot tell you the
 * policy is correct, only that it parses. Behavioural tests (does a `staff` user
 * actually get denied on a clergy-only prayer request?) still need
 * @firebase/rules-unit-testing.
 *
 * Run via: npm run rules:check
 */
import { readFileSync } from 'node:fs';

const PROJECT = 'demo-spsm';

const TARGETS = [
  {
    file: 'firestore.rules',
    url: `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`,
    body: (content, file) => ({ rules: { files: [{ name: file, content }] } }),
  },
  {
    file: 'storage.rules',
    url: 'http://127.0.0.1:9199/internal/setRules',
    body: (content, file) => ({ rules: { files: [{ name: file, content }] } }),
  },
];

let failed = false;

for (const target of TARGETS) {
  let content;
  try {
    content = readFileSync(target.file, 'utf8');
  } catch {
    console.log(`SKIP  ${target.file} (not found)`);
    continue;
  }

  let res;
  try {
    res = await fetch(target.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target.body(content, target.file)),
    });
  } catch (error) {
    console.log(`FAIL  ${target.file}: emulator unreachable at ${target.url}`);
    console.log(`      ${error.message}`);
    console.log('      Run this through: npm run rules:check');
    failed = true;
    continue;
  }

  if (res.ok) {
    console.log(`PASS  ${target.file}`);
    continue;
  }

  console.log(`FAIL  ${target.file} -> HTTP ${res.status}`);
  console.log((await res.text()).slice(0, 4000));
  failed = true;
}

process.exit(failed ? 1 : 0);
