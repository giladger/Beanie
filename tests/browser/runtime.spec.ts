import { expect, test } from '@playwright/test';

test('gateway failure reaches an explicit, usable demo shell', async ({ page }) => {
  const pageErrors: Error[] = [];
  let workflowWrites = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'PUT' && new URL(route.request().url()).pathname === '/api/v1/workflow') {
      workflowWrites += 1;
    }
    return route.abort('failed');
  });

  await page.goto('/');

  const mode = page.locator('.runtime-mode-banner');
  await expect(mode).toContainText('DEMO · sample data');
  await expect(mode).toContainText('changes are not saved');
  await expect(page.locator('.top-stat.stat-tone-alert')).toContainText('Demo');

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await expect(page.locator('[data-action="settings-theme"]').first()).toBeEnabled();

  // Seed the same IndexedDB schema production startup uses, then prove the next
  // failed boot is cached/offline—not demo—and cannot replay a stale workflow.
  // This intentionally avoids importing source modules: the smoke test runs
  // against the built release bundle, where /src is not available.
  await page.evaluate(async () => {
    const bean = {
      id: 'cached-bean',
      roaster: 'Cache Roaster',
      name: 'Offline Lot',
      country: 'Ethiopia'
    };
    const workflow = {
      name: 'Cached workflow',
      profile: {
        title: 'Cached profile',
        author: 'Browser test',
        beverage_type: 'espresso',
        target_weight: 40,
        tank_temperature: 93,
        steps: [{ name: 'Pour' }]
      },
      context: {
        targetDoseWeight: 18,
        targetYield: 40,
        coffeeRoaster: bean.roaster,
        coffeeName: bean.name,
        beanId: bean.id
      }
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('beanie-cache', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const timestamp = new Date().toISOString();
    const transaction = db.transaction(['beans', 'objects'], 'readwrite');
    transaction.objectStore('beans').put({
      id: bean.id,
      item: bean,
      updatedAt: timestamp,
      schemaVersion: 1
    });
    transaction.objectStore('objects').put({
      key: 'collection:beans:ids',
      value: [bean.id],
      updatedAt: timestamp,
      schemaVersion: 1
    });
    transaction.objectStore('objects').put({
      key: 'workflow:current',
      value: workflow,
      updatedAt: timestamp,
      schemaVersion: 1
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();

  await expect(mode).toContainText('OFFLINE · cached data');
  await page.getByRole('button', { name: 'Increase Dose' }).click();
  await expect(page.locator('.recipe-apply-chip')).toHaveCount(0);
  expect(workflowWrites).toBe(0);
  expect(pageErrors).toEqual([]);
});
