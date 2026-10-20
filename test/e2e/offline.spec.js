// Offline operation through the service worker: first load online, then reload and complete
// visits with the network switched off.
'use strict';

const { test, expect } = require('@playwright/test');
const { registry, press, readRecord, driveVisit } = require('./helpers.js');

test.use({ serviceWorkers: 'allow' });

async function installAndGoOffline(page, context) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const c = await caches.open(names[0]);
    return { names, keys: (await c.keys()).map(r => new URL(r.url).pathname) };
  });
  await context.setOffline(true);
  return cached;
}

test('the app shell is precached under a build-specific cache and /api is never cached', async ({ page, context }) => {
  const cached = await installAndGoOffline(page, context);
  expect(cached.names).toHaveLength(1);
  expect(cached.names[0]).toMatch(/^dastak-[0-9a-f]{12}$/);
  for (const p of ['/', '/glasses.html', '/js/engine.js', '/js/store.js', '/js/glasses-app.js', '/generated/registry.js', '/record.html']) {
    expect(cached.keys).toContain(p);
  }
  expect(cached.keys.filter(k => k.startsWith('/api/'))).toEqual([]);
});

test('offline reload of / and /glasses.html still runs a complete visit', async ({ page, context }) => {
  await installAndGoOffline(page, context);
  await page.reload();
  await expect(page.locator('#ctx-progress')).toContainText('household');
  await press(page, 'Enter');
  await driveVisit(page, registry.protocols[0], 'defaults');
  expect((await readRecord(page)).status).toBe('complete');

  await page.goto('/glasses.html');
  await expect(page.locator('#ctx-progress')).toContainText('household');
  await press(page, 'ArrowDown', 'Enter');
  await driveVisit(page, registry.protocols[1], 'defaults');
});

test('offline: record page, planner fallback, and an uncached route falls back to the app', async ({ page, context }) => {
  await installAndGoOffline(page, context);
  await page.goto('/record.html');
  await expect(page.locator('#content')).toContainText('No completed visit');
  await page.goto('/plan.html');
  await expect(page.locator('#content')).toContainText('server unreachable; planned on this device');
  await expect(page.locator('.item').first()).toContainText('H-087');
  await page.goto('/index.html');
  await expect(page.locator('#ctx-progress')).toContainText('household');
});

test('interrupted visit survives going offline and reloading', async ({ page, context }) => {
  await installAndGoOffline(page, context);
  await page.reload();
  await press(page, 'Enter', 'Enter', 'ArrowLeft', 'Enter');
  await page.reload();
  await press(page, 'Enter');
  await expect(page.locator('.kicker')).toHaveText('Interrupted visit');
});
