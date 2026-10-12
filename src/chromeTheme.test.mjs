import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readStylesheet } from './testSupport/readStylesheet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readStylesheet(path.join(ROOT, 'style.css'));
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * Product decision: the whole UI renders in Open Sans, white. No cyan/teal
 * "cockpit green" anywhere in the chrome. Saturated cool accents are the
 * regression this pin catches; neutrals, near-black surfaces, and the warm
 * alert/amber/red families are all intentional and allowed.
 */

function isSaturatedCool(r, g, b) {
  const mx = Math.max(r, g, b);
  const spread = mx - Math.min(r, g, b);
  if (mx <= 32 || Math.min(r, g, b) >= 225 || spread <= 28) return false;
  if (r > g && r > b && r - Math.min(g, b) >= 30) return false;
  if (r > g && b > g && Math.min(r, b) - g >= 30) return false;
  if (mx < 120) return false;
  return spread > 90 || spread / mx > 0.45;
}

test('chrome styles carry no saturated cyan/teal/green accent', () => {
  const offenders = [];
  for (const match of bare.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const h = match[1];
    const rgb = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((x) =>
      Number.parseInt(x, 16),
    );
    if (isSaturatedCool(...rgb)) offenders.push(match[0]);
  }
  const comma =
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,[^)]+)?\)/g;
  for (const match of bare.matchAll(comma)) {
    const rgb = [match[1], match[2], match[3]].map(Number);
    if (isSaturatedCool(...rgb)) offenders.push(match[0].slice(0, 42));
  }
  const spaced = /rgba?\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(\/[^)]+)?\)/g;
  for (const match of bare.matchAll(spaced)) {
    const rgb = [match[1], match[2], match[3]].map(Number);
    if (isSaturatedCool(...rgb)) offenders.push(match[0].slice(0, 42));
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `saturated cool accents regressed into the chrome: ${[...new Set(offenders)].join(', ')}`,
  );
  assert.doesNotMatch(
    bare,
    /:\s*(cyan|aqua|teal|green|lime|turquoise|aquamarine|springgreen)\s*;/i,
    'no named cool colors in declarations',
  );
});

test('chrome type resolves to Open Sans', () => {
  assert.match(css, /--font-mono:\s*'Open Sans'/);
  assert.match(css, /--font-sans:\s*'Open Sans'/);
  const head = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(head, /family=Open\+Sans/);
  assert.doesNotMatch(head, /JetBrains\+Mono/);
  assert.doesNotMatch(head, /family=Inter/);
});
