// The wearable workflow in a real browser at 600×600, keyboard only.
// Each regression test names the audit finding it guards (docs/AUDIT.md).
'use strict';

const { test, expect } = require('@playwright/test');
const { E, registry, VISITS_KEY, openFresh, press, readRecord, expectFrameSound, simulate, driveVisit } = require('./helpers.js');

test.use({ serviceWorkers: 'block' });

const prompt = page => page.locator('.prompt');

test.describe('every bundled protocol, keyboard only', () => {
  registry.protocols.forEach((p, index) => {
    for (const strategy of ['defaults', 'alternates']) {
      test(p.id + ' · ' + strategy, async ({ page }) => {
        await openFresh(page);
        await expectFrameSound(page);
        // H-104's scheduled protocol is first in the list; move to this protocol.
        for (let i = 0; i < index; i++) await press(page, 'ArrowDown');
        await press(page, 'Enter');
        await expect(page.locator('#ctx-label')).toHaveText(p.label);
        await driveVisit(page, p, strategy);
        const expected = simulate(p, strategy);
        const record = await readRecord(page);
        expect(record.status).toBe('complete');
        expect(record.protocolId).toBe(p.id);
        expect(record.answers.length).toBe(expected.answers);
        expect(record.flags.map(f => f.stepId)).toEqual(expected.flags);
        await expect(page.locator('.prompt')).toHaveText('H-104 · ' + expected.answers + ' answers');
      });
    }
  });
});

test.describe('regressions', () => {
  test('C5: choosing a protocol with ↓ then Enter starts it', async ({ page }) => {
    await openFresh(page);
    await press(page, 'ArrowDown', 'Enter');
    await expect(page.locator('#ctx-label')).toHaveText(registry.protocols[1].label);
    await expect(prompt(page)).toHaveText(registry.protocols[1].steps[0].prompt);
  });

  test('C4: count frames adjust with ↑/↓ and confirm with Enter', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter');                       // weight, default 2.8
    await press(page, 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp');
    await expect(page.locator('.count')).toHaveText('3.0');
    await press(page, 'Enter');
    await expect(prompt(page)).toHaveText('Is the baby breastfeeding well?');
    const saved = await page.evaluate(k => Object.values(JSON.parse(localStorage.getItem(k)))[0], VISITS_KEY);
    expect(saved.path[0]).toEqual({ stepId: 'weight', answer: 3 });
  });

  test('count frames clamp at their bounds', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter');
    for (let i = 0; i < 60; i++) await press(page, 'ArrowDown');
    await expect(page.locator('.count')).toHaveText('1.0');
    for (let i = 0; i < 60; i++) await press(page, 'ArrowUp');
    await expect(page.locator('.count')).toHaveText('6.0');
  });

  test('H1: a referral frame is recorded once', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');   // weight, feeding: No
    await expect(page.locator('.kicker')).toHaveText('Referral flag');
    await expect(prompt(page)).toHaveText('Feeding difficulty recorded');
    await press(page, 'Enter', 'ArrowLeft', 'Enter', 'Enter', 'Enter', 'Enter'); // temp No, cord Yes, activity Yes, counselling
    const r = await readRecord(page);
    expect(r.flags.map(f => f.stepId)).toEqual(['flag_feeding']);
  });

  test('H2: Back steps one question and removes flags from the abandoned branch', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');   // referral frame
    await press(page, 'Escape');
    await expect(prompt(page)).toHaveText('Is the baby breastfeeding well?');
    await expect(page.locator('#ctx-progress')).toContainText('Q2');
    await press(page, 'Enter');                                   // Yes this time
    await expect(prompt(page)).toHaveText('Does the baby feel cold to touch?');
    await press(page, 'ArrowLeft', 'Enter', 'Enter', 'Enter', 'Enter');
    const r = await readRecord(page);
    expect(r.flags).toEqual([]);
  });

  test('H2: system Back (history) also steps back one question', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter');
    await expect(prompt(page)).toHaveText('Is the baby breastfeeding well?');
    await page.goBack();
    await expect(prompt(page)).toHaveText("Record the baby's weight");
  });

  test('H2: a completed visit cannot be reopened', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter');
    await driveVisit(page, registry.protocols[0], 'defaults');
    await press(page, 'Escape');
    await expect(page.locator('#ctx-progress')).toContainText('household');
    await page.goBack().catch(() => {});
    await expect(page.locator('.kicker', { hasText: 'Visit complete' })).toHaveCount(0);
    await expect(page.locator('.prompt')).toHaveCount(0);
  });

  test('C2: resume after reload keeps earlier answers and referral flags', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');   // reach referral frame
    await page.reload();
    await expect(page.locator('[role="radio"]', { hasText: 'Routine Home Visit' })).toContainText('interrupted');
    await press(page, 'Enter');
    await expect(page.locator('.kicker')).toHaveText('Interrupted visit');
    await expect(prompt(page)).toHaveText('Resume H-104 at question 3?');
    await press(page, 'Enter');                                   // Resume
    await expect(prompt(page)).toHaveText('Feeding difficulty recorded');
    await driveVisit(page, registry.protocols[0], 'defaults');
    const r = await readRecord(page);
    expect(r.flags.map(f => f.stepId)).toEqual(['flag_feeding', 'flag_temp']);
    expect(r.answers[0]).toEqual({ stepId: 'weight', prompt: "Record the baby's weight", answer: '2.8 kg' });
  });

  test('start over discards the interrupted visit', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'Enter');
    await page.reload();
    await press(page, 'Enter', 'ArrowRight', 'Enter');          // Start over
    await expect(page.locator('#ctx-progress')).toContainText('Q1');
    await expect(prompt(page)).toHaveText("Record the baby's weight");
  });

  test('C3: after a resume, starting another protocol starts at its first question', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter');
    await page.reload();
    await press(page, 'Enter', 'Enter');                         // resume at Q2
    await press(page, 'Escape', 'Escape');                       // back to Q1, then to start frame
    await expect(page.locator('#ctx-progress')).toContainText('household');
    await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
    await expect(page.locator('#ctx-label')).toHaveText(registry.protocols[2].label);
    await expect(prompt(page)).toHaveText(registry.protocols[2].steps[0].prompt);
    await expect(page.locator('.kicker', { hasText: 'Visit complete' })).toHaveCount(0);
  });

  test('C3: a protocol pointing to a missing step shows an error, never COMPLETE, and writes no record', async ({ page }) => {
    const broken = JSON.parse(JSON.stringify(registry));
    broken.protocols[0].steps.find(s => s.id === 'feeding').onNo = 'missing_step';
    await page.route('**/generated/registry.js', route => route.fulfill({
      contentType: 'application/javascript', body: 'self.DASTAK_REGISTRY = ' + JSON.stringify(broken) + ';'
    }));
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');
    await expect(page.locator('.kicker')).toHaveText('Protocol error');
    await expect(prompt(page)).toHaveText('This visit is NOT complete and was not recorded.');
    await expect(page.locator('#main')).toContainText('missing step "missing_step"');
    expect(await readRecord(page)).toBeNull();
    await press(page, 'Enter');                                   // go back
    await expect(prompt(page)).toHaveText('Is the baby breastfeeding well?');
  });

  test('H6: range frames show a 5-row window starting at the protocol default; rules route on the chosen value', async ({ page }) => {
    await openFresh(page);
    await press(page, 'ArrowDown', 'Enter', 'Enter');            // Danger Signs, fever: Yes
    await expect(prompt(page)).toHaveText("Record the beneficiary's temperature");
    await expect(page.locator('[role="radio"]')).toHaveCount(5);
    await expect(page.locator('[aria-checked="true"]')).toHaveText('36.5 °C');
    await expectFrameSound(page);
    await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown');
    await expect(page.locator('[aria-checked="true"]')).toHaveText('38.5 °C');
    await press(page, 'ArrowDown');
    await expect(page.locator('[aria-checked="true"]')).toHaveText('39.0 °C');
    await expectFrameSound(page);
    await press(page, 'Enter');
    await expect(page.locator('.kicker')).toHaveText('Referral flag');
    await expect(prompt(page)).toHaveText('Refer to the health facility.');
  });

  test('H3: the triage line reflects the roster', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('#main')).toContainText(E.triageNote(registry.roster));
  });

  test('←/→ changes household and preselects its scheduled protocol', async ({ page }) => {
    await openFresh(page);
    await press(page, 'ArrowRight');
    const h = registry.roster[1];
    await expect(page.locator('.kicker').first()).toContainText(h.id + ' · ' + h.area);
    const scheduled = registry.protocols.find(p => p.id === h.protocolId);
    await expect(page.locator('[aria-checked="true"]')).toContainText(scheduled.label);
  });

  test('carry-forward: a flag from the last visit is shown for the same household and protocol only', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');   // flag_feeding
    await driveVisit(page, registry.protocols[0], 'defaults');
    await press(page, 'Enter');                                   // back to start
    await expect(page.locator('#main')).toContainText('flagged last visit: Feeding difficulty recorded');
    await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');   // same protocol, reach flag_feeding
    await expect(page.locator('#main')).toContainText('also flagged at the last Routine Home Visit visit');
    await press(page, 'Escape', 'Escape', 'Escape');
    await press(page, 'ArrowRight');                              // another household
    await expect(page.locator('#main')).not.toContainText('flagged last visit');
  });
});

test.describe('storage failures', () => {
  test('H5: blocked storage — app runs, says NOT SAVED, and completes a visit', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#ctx-save')).toHaveText('NOT SAVED');
    await press(page, 'Enter', 'Enter');
    await expect(prompt(page)).toHaveText('Is the baby breastfeeding well?');
    for (let i = 0; i < 12 && !(await page.locator('.kicker', { hasText: 'Visit complete' }).count()); i++) await press(page, 'Enter');
    await expect(page.locator('#main')).toContainText('NOT SAVED: storage is unavailable');
    expect(errors).toEqual([]);
  });

  test('full storage — writes fail and the frame says NOT SAVED', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k !== 'dastak.probe' && sessionStorage.getItem('full') === '1' && this === localStorage) throw new DOMException('full', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.setItem('full', '1'));
    await press(page, 'Enter');
    await expect(page.locator('#ctx-save')).toHaveText('NOT SAVED');
  });
});

test.describe('settings and data deletion', () => {
  test('setup controls live on a separate frame; delete lists what is removed and removes it', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Enter');
    await driveVisit(page, registry.protocols[0], 'defaults');
    await press(page, 'Enter');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dastak')).length)).toBeGreaterThan(0);
    await expect(page.locator('#main')).not.toContainText('Voice');
    await press(page, 'ArrowUp', 'Enter');                       // wraps to Settings
    await expect(page.locator('#ctx-label')).toHaveText('Settings');
    await expectFrameSound(page);
    await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
    await expect(page.locator('#main')).toContainText('interrupted visits, carry-forward flags, the last visit record and the voice setting');
    await expect(page.locator('[aria-checked="true"]')).toHaveText('Cancel');
    await press(page, 'ArrowRight', 'Enter');
    await expect(page.locator('#main')).toContainText('Local data deleted.');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dastak')))).toEqual([]);
  });
});

test.describe('network boundary', () => {
  test('a full visit makes no network requests, and CSP blocks page-initiated fetches', async ({ page }) => {
    await openFresh(page);
    await page.waitForLoadState('networkidle');
    const requests = [];
    page.on('request', r => requests.push(r.method() + ' ' + r.url()));
    await press(page, 'Enter');
    await driveVisit(page, registry.protocols[0], 'defaults');
    expect(requests).toEqual([]);

    // Deliberately attempt exfiltration from the page: CSP connect-src 'none' must stop it.
    const completed = [];
    page.on('requestfinished', r => { if (r.url().includes('/api/')) completed.push(r.url()); });
    const result = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
      const f = await fetch('/api/protocol/home_visit').then(() => 'allowed', () => 'blocked');
      const x = await new Promise(resolve => {
        const r = new XMLHttpRequest();
        r.onload = () => resolve('allowed'); r.onerror = () => resolve('blocked');
        try { r.open('GET', '/api/protocol/home_visit'); r.send(); } catch (e) { resolve('blocked'); }
      });
      navigator.sendBeacon('/api/plan', '{}'); // returns true even when CSP later blocks the send
      await new Promise(r => setTimeout(r, 500));
      return { fetch: f, xhr: x, violations };
    });
    expect(result.fetch).toBe('blocked');
    expect(result.xhr).toBe('blocked');
    expect(result.violations.filter(d => d === 'connect-src').length).toBeGreaterThanOrEqual(3);
    expect(completed).toEqual([]);
  });
});
