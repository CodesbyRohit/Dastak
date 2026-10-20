#!/usr/bin/env node
// ============================================================
// DASTAK — Protocol conformance and drift check
// Usage: node verify.js [--root <dir>]
//
// Exits non-zero if any of these fail:
//   1. Every protocols/*.json validates against schema/protocol.schema.json (Ajv).
//   2. Semantic checks (scripts/lib/validate-protocol.js): unique IDs, start step and every
//      transition target exist, type-specific fields, option rules, numeric grids and
//      defaults, rules that can never or always fire, reachability, no cycles, every
//      step can reach the end, content lifecycle and review metadata.
//   3. protocols/manifest.json lists exactly the protocol files; roster is valid and
//      references bundled protocols.
//   4. public/generated/registry.js and the generated section of public/sw.js are
//      byte-identical to a fresh build (no drift from the canonical JSON).
//   5. No protocol ID appears as a string literal in engine/app code (the engine stays
//      protocol-agnostic).
//
// This is a STRUCTURAL check. It does not and cannot establish clinical correctness.
// Runtime behaviour is covered by `npm test` and `npm run test:e2e`.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { build, printErrors, lf } = require('./scripts/build-registry.js');

const i = process.argv.indexOf('--root');
const root = path.resolve(i !== -1 ? process.argv[i + 1] : __dirname);

console.log('\n=== Dastak protocol conformance (structural only) ===\n');

const result = build(root);
const errors = result.errors.slice();

if (!errors.length) {
  for (const [rel, expected] of Object.entries(result.outputs)) {
    let actual = null;
    try { actual = lf(fs.readFileSync(path.join(root, rel), 'utf8')); } catch (e) { /* missing */ }
    if (actual !== expected) {
      errors.push({
        code: 'GENERATED_DRIFT',
        where: rel.replace(/\\/g, '/'),
        message: actual === null ? 'Generated file is missing. Run `npm run build`.'
          : 'Committed file differs from a fresh build of the canonical sources. Run `npm run build` and commit the result.'
      });
    }
  }

  const registry = require(path.join(root, 'public', 'generated', 'registry.js'));
  const ids = [];
  for (const p of registry.protocols) ids.push(p.id, ...(p.legacyIds || []));
  for (const rel of ['public/js/engine.js', 'public/js/store.js', 'public/js/glasses-app.js']) {
    let code;
    try { code = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { continue; }
    for (const id of ids) {
      if (new RegExp('[\'"`]' + id + '[\'"`]').test(code)) {
        errors.push({ code: 'PROTOCOL_SPECIFIC_CODE', where: rel, message: 'Protocol ID "' + id + '" appears as a string literal' });
      }
    }
  }

  if (!errors.length) {
    console.log('Build ' + result.buildId + '\n');
    for (const p of registry.protocols) {
      const unsourced = p.steps.filter(s => s.content_source === 'UNSOURCED').length;
      console.log('  ✓ ' + p.id.padEnd(16) + p.status.padEnd(21) + String(p.steps.length).padStart(2) + ' steps  ' +
        String(unsourced).padStart(2) + ' UNSOURCED  review: ' + p.provenance.review.state);
    }
    console.log('  ✓ roster: ' + registry.roster.length + ' households, all mapped to bundled protocols');
    console.log('  ✓ generated registry and service-worker section match a fresh build');
    console.log('  ✓ no protocol IDs hard-coded in engine/app code');
  }
}

if (errors.length) {
  console.error('✗ ' + errors.length + ' problem(s):');
  printErrors(errors);
  console.error('');
  process.exit(1);
}

console.log('\nStructural checks passed. This is not clinical validation.\n');
