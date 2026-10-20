'use strict';

const { expect } = require('@playwright/test');
const E = require('../../public/js/engine.js');
const registry = require('../../public/generated/registry.js');

const RECORD_KEY = 'dastak.record.v2';
const VISITS_KEY = 'dastak.visits.v2';

async function openFresh(page, path) {
  await page.goto(path || '/');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* storage blocked */ } });
  await page.reload();
  await expect(page.locator('#ctx-progress')).toContainText('household');
}

async function press(page, ...keys) {
  for (const k of keys) await page.keyboard.press(k);
}

async function readRecord(page) {
  return page.evaluate(k => { const r = localStorage.getItem(k); return r && JSON.parse(r); }, RECORD_KEY);
}

// Asserts the frame fits the 600×600 display and the highlighted item has visible focus.
async function expectFrameSound(page) {
  const m = await page.evaluate(() => {
    const main = document.getElementById('main');
    const a = document.activeElement;
    const cs = a ? getComputedStyle(a) : null;
    return {
      docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth,
      mainOverflow: main.scrollHeight - main.clientHeight,
      focusChecked: !!a && a.getAttribute('aria-checked') === 'true',
      outline: cs ? cs.outlineStyle + ' ' + parseFloat(cs.outlineWidth) : ''
    };
  });
  expect(m.docH, 'page height').toBeLessThanOrEqual(600);
  expect(m.docW, 'page width').toBeLessThanOrEqual(600);
  expect(m.mainOverflow, 'content overflows the frame').toBeLessThanOrEqual(0);
  expect(m.focusChecked, 'focus is on the highlighted option').toBe(true);
  expect(m.outline, 'focus ring visible').toMatch(/^solid [3-9]/);
}

// Simulates a strategy in the engine to get the expected outcome for a browser run.
//   defaults:   yes/no → Yes, choice → first, range/count → protocol default
//   alternates: yes/no → No,  choice → last,  range → max, count → min
function simulate(protocol, strategy) {
  let v = E.createVisit(protocol, 'H-x', 0);
  const steps = E.stepMap(protocol);
  while (v.status === 'in_progress') {
    const s = steps[v.current];
    let a;
    if (s.type === 'info') a = 'ack';
    else if (s.type === 'yesno') a = strategy === 'defaults' ? 'yes' : 'no';
    else if (s.type === 'choice') { const o = E.normalizeOptions(s); a = (strategy === 'defaults' ? o[0] : o[o.length - 1]).value; }
    else { const g = E.gridValues(s); a = strategy === 'defaults' ? s.default : (s.type === 'range' ? g[g.length - 1] : g[0]); }
    v = E.applyAnswer(protocol, v, a, 0).visit;
  }
  return { status: v.status, answers: v.path.length, flags: E.visitFlags(protocol, v).map(f => f.stepId) };
}

// Drives the current visit to completion with keyboard only, checking every frame.
async function driveVisit(page, protocol, strategy) {
  const steps = E.stepMap(protocol);
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.kicker', { hasText: 'Visit complete' }).count()) return;
    await expectFrameSound(page);
    const current = await page.evaluate(k => {
      const m = JSON.parse(localStorage.getItem(k) || '{}');
      const v = Object.values(m)[0];
      return v && v.current;
    }, VISITS_KEY);
    const s = steps[current];
    if (strategy === 'alternates' && s) {
      if (s.type === 'yesno') await press(page, 'ArrowLeft');
      else if (s.type === 'choice') await press(page, 'ArrowUp'); // wraps to the last option
      else if (s.type === 'range') for (let k = 0; k < E.gridValues(s).length; k++) await press(page, 'ArrowDown');
      else if (s.type === 'count') for (let k = 0; k < E.gridValues(s).length; k++) await press(page, 'ArrowDown');
    }
    await press(page, 'Enter');
  }
  throw new Error('visit did not complete within 40 frames');
}

module.exports = { E, registry, RECORD_KEY, VISITS_KEY, openFresh, press, readRecord, expectFrameSound, simulate, driveVisit };
