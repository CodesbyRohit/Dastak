// Phone-facing pages: record rendering safety, planner and review behaviour.
'use strict';

const { test, expect } = require('@playwright/test');
const { E, registry, RECORD_KEY } = require('./helpers.js');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

function sampleRecord() {
  const p = registry.protocols[0];
  let v = E.createVisit(p, 'H-104', Date.UTC(2026, 9, 20, 9));
  for (const a of [2.8, 'no', 'ack', 'no', 'yes', 'yes', 'Feeding']) v = E.applyAnswer(p, v, a, Date.UTC(2026, 9, 20, 9, 5)).visit;
  return E.buildRecord(p, v, { area: 'Sector 3' });
}

test.describe('record.html', () => {
  test('renders a stored record with every value as text', async ({ page }) => {
    const r = sampleRecord();
    r.answers[0].prompt = '<img src=x onerror="window.__xss=1">';
    r.flags[0].referral = '<script>window.__xss=2</script>';
    await page.goto('/record.html');
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [RECORD_KEY, r]);
    await page.reload();
    await expect(page.locator('#content')).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(page.locator('#content')).toContainText('Feeding difficulty recorded');
    await expect(page.locator('#content img, #content script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('C6: records in the URL fragment are ignored and removed from the address bar', async ({ page }) => {
    const payload = Buffer.from(JSON.stringify(Object.assign(sampleRecord(), { protocolLabel: '<img src=x onerror="window.__xss=1">' }))).toString('base64');
    await page.goto('/record.html#' + payload);
    await expect(page.locator('.banner')).toContainText('Records are not accepted via links');
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.evaluate(k => localStorage.getItem(k), RECORD_KEY)).toBeNull();
  });

  test('a malformed stored record is not shown and is deleted', async ({ page }) => {
    await page.goto('/record.html');
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ kind: 'dastak.visit-record', protocol: '<b>x</b>' })), RECORD_KEY);
    await page.reload();
    await expect(page.locator('#content')).toContainText('No completed visit');
    expect(await page.evaluate(k => localStorage.getItem(k), RECORD_KEY)).toBeNull();
  });

  test('delete button clears Dastak data after confirmation', async ({ page }) => {
    await page.goto('/record.html');
    await page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('other', '1'); }, [RECORD_KEY, sampleRecord()]);
    await page.reload();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: /Delete all Dastak data/ }).click();
    await expect(page.locator('#content')).toContainText('was deleted');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['other']);
  });
});

test.describe('plan.html', () => {
  test('lists every roster household; reasons follow the fixed rule', async ({ page }) => {
    await page.goto('/plan.html');
    await expect(page.locator('.item')).toHaveCount(registry.roster.length);
    const titles = await page.locator('.item .title').allTextContents();
    const ids = titles.map(t => t.split(' ')[1]);
    expect(ids.slice().sort()).toEqual(registry.roster.map(h => h.id).sort());
    const reasons = await page.locator('.item .reason').allTextContents();
    expect(reasons.every(r => /^(overdue by \d+ days?|flagged last visit|due today|due in \d+ days?)$/.test(r))).toBe(true);
    await expect(page.locator('.banner').first()).toContainText(/fixed rule|reasons are computed by a fixed rule/i);
  });

  test('a server plan that drops a household is rejected in the browser', async ({ page }) => {
    await page.route('**/api/plan', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ order: [{ id: 'H-087', reason: 'urgent: fever' }], source: 'ai' }) }));
    await page.goto('/plan.html');
    await expect(page.locator('.banner').first()).toContainText('server response rejected');
    await expect(page.locator('.item')).toHaveCount(registry.roster.length);
    await expect(page.locator('#content')).not.toContainText('fever');
  });
});

test.describe('review.html', () => {
  test('shows the counted summary and labels the sample data', async ({ page }) => {
    await page.goto('/review.html');
    await expect(page.locator('.summary').first()).toContainText('6 visits across 3 areas. 3 referral flags recorded');
    await expect(page.locator('.header')).toContainText('SAMPLE DATA');
  });

  test('server text is rendered as text', async ({ page }) => {
    await page.route('**/api/review', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      summary: '<img src=x onerror="window.__xss=1">', data: { totalVisits: 1, totalFlags: 0, flagsByType: {}, visitsByArea: { '<b>A</b>': 1 } },
      aiSummary: { text: '<script>window.__xss=2</script>', label: 'AI' }
    }) }));
    await page.goto('/review.html');
    await expect(page.locator('#content')).toContainText('<img src=x');
    await expect(page.locator('#content img, #content script, #content b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});
