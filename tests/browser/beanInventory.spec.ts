import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Adding coffee and bags is the one flow in the skin where a stray commit costs
// real data: every POST creates another record the user then has to delete. The
// checks here drive the real forms through a browser so the DOM's own event
// order — blur, click, submit, and the render that follows the save — is part
// of what is under test.

interface GatewayLog {
  readonly beanPosts: unknown[];
  readonly batchPosts: unknown[];
  readonly beanPuts: unknown[];
}

async function fakeGateway(page: Page): Promise<GatewayLog> {
  const log: GatewayLog = { beanPosts: [], batchPosts: [], beanPuts: [] };
  const beans: Record<string, unknown>[] = [];
  const batches: Record<string, Record<string, unknown>[]> = {};
  const store: Record<string, unknown> = { 'beanie.favorite-profiles': '["preset-1"]' };
  let beanSeq = 0;
  let batchSeq = 0;

  await page.routeWebSocket('**/ws/v1/**', (socket) => { socket.onMessage(() => {}); });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = () => (request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {});
    const json = (value: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    // A gateway on the machine answers over the network, so every mutation has
    // a window in which a second one can start. Keep that window here.
    await new Promise((resolve) => setTimeout(resolve, 60));

    if (path === '/api/v1/store/beanie') return json(store);
    if (path.startsWith('/api/v1/store/beanie/')) {
      const key = decodeURIComponent(path.split('/').at(-1)!);
      if (method === 'POST') store[key] = request.postDataJSON();
      return json(store[key] ?? null);
    }
    if (/^\/api\/v1\/bean-batches\/[^/]+$/.test(path) && method === 'PUT') {
      const id = path.split('/')[4]!;
      const batch = Object.values(batches).flat().find((item) => item.id === id)!;
      Object.assign(batch, body());
      return json(batch);
    }
    if (path === '/api/v1/beans' && method === 'POST') {
      beanSeq += 1;
      const bean = { id: `bean-${beanSeq}`, ...body() };
      beans.push(bean);
      batches[bean.id] = [];
      log.beanPosts.push(bean);
      return json(bean);
    }
    if (path === '/api/v1/beans' && method === 'GET') return json(beans);
    if (/^\/api\/v1\/beans\/[^/]+$/.test(path) && method === 'PUT') {
      const id = decodeURIComponent(path.split('/')[4]!);
      const index = beans.findIndex((bean) => bean.id === id);
      const bean = { ...(beans[index] ?? { id }), ...body() };
      if (index >= 0) beans[index] = bean;
      log.beanPuts.push(bean);
      return json(bean);
    }
    if (/^\/api\/v1\/beans\/[^/]+\/batches$/.test(path)) {
      const beanId = decodeURIComponent(path.split('/')[4]!);
      if (method === 'POST') {
        batchSeq += 1;
        const batch = { id: `batch-${batchSeq}`, beanId, ...body() };
        batches[beanId] = [...(batches[beanId] ?? []), batch];
        log.batchPosts.push(batch);
        return json(batch);
      }
      return json(batches[beanId] ?? []);
    }
    if (path === '/api/v1/workflow') {
      return json({
        name: 'Fake workflow',
        profile: {
          title: 'Fake profile',
          author: 'Browser test',
          beverage_type: 'espresso',
          target_weight: 40,
          tank_temperature: 93,
          steps: [{ name: 'Pour' }]
        },
        context: { targetDoseWeight: 19, targetYield: 40 }
      });
    }
    if (path === '/api/v1/machine/info') return json({ version: '1.0', model: 'DE1' });
    if (path === '/api/v1/machine/state') return json({ state: { state: 'idle', substate: '' } });
    if (path === '/api/v1/machine/capabilities') return json({ capabilities: [] });
    if (path === '/api/v1/shots') return json({ items: [], total: 0, limit: 20, offset: 0 });
    if (path === '/api/v1/profiles') return json([{ id: 'preset-1', profile: {
      title: 'Morning preset', author: 'Browser test', beverage_type: 'espresso', target_weight: 40,
      tank_temperature: 93, steps: [{ name: 'Pour' }]
    } }]);
    if (path === '/api/v1/grinders') return json([]);
    if (path === '/api/v1/devices' || path === '/api/v1/plugins') return json([]);
    if (path === '/api/v1/webui/skins') return json([]);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  return log;
}

async function openCreateForm(page: Page): Promise<void> {
  await page.locator('[data-action="open-bean-picker"]').first().click();
  await expect(page.locator('.bean-picker-modal')).toBeVisible();
  await page.locator('[data-action="open-add-bean"]').first().click();
  await expect(page.locator('.bean-picker-modal.create-mode')).toBeVisible();
  const form = page.locator('form[data-form="bean-picker-bean"]');
  await form.locator('[name="roaster"]').fill('Test');
  await form.locator('[name="name"]').fill('Test');
  await form.locator('[name="country"]').fill('Test');
}

test('adding a coffee saves one coffee and one bag, and adding a bag saves one bag', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  const log = await fakeGateway(page);

  await page.goto('/');
  await expect(page.locator('[data-action="open-bean-picker"]').first()).toBeVisible();
  await openCreateForm(page);

  // Tapping "Add coffee" blurs a field and clicks inside the modal before the
  // form's own submit arrives, and the save's render then blurs again. Exactly
  // one coffee and one bag may come out of all of that.
  await page.getByRole('button', { name: 'Add coffee' }).click();
  await expect(page.locator('.bean-row')).toHaveCount(1);
  await expect(page.locator('.bean-picker-batches .stock-row')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(log.beanPosts).toHaveLength(1);
  expect(log.batchPosts).toHaveLength(1);

  // A second bag of the same coffee is one more bag, not one more coffee.
  await page.locator('[data-action="bean-picker-add-batch"]').first().click();
  await page.getByRole('button', { name: 'Add bag' }).click();
  await expect(page.locator('.bean-picker-batches .stock-row')).toHaveCount(2);
  await page.waitForTimeout(500);
  expect(log.beanPosts).toHaveLength(1);
  expect(log.batchPosts).toHaveLength(2);
  expect(await page.locator('.bean-row').count()).toBe(1);

  expect(pageErrors).toEqual([]);
});

test('the edit form still saves a coffee when focus leaves it', async ({ page }) => {
  const log = await fakeGateway(page);

  await page.goto('/');
  await expect(page.locator('[data-action="open-bean-picker"]').first()).toBeVisible();
  await openCreateForm(page);
  await page.getByRole('button', { name: 'Add coffee' }).click();
  await expect(page.locator('.bean-row')).toHaveCount(1);

  // The edit form carries no save button: leaving it is what commits.
  await page.locator('[data-action="toggle-bean-details"]').first().click();
  const form = page.locator('.bean-picker-details.open form[data-form="bean-picker-bean"]');
  await expect(form).toBeVisible();
  await form.locator('[name="roaster"]').fill('Edited Roaster');
  await page.locator('.bean-picker-head h2').click();

  await expect(page.locator('.bean-row b')).toHaveText('Edited Roaster');
  expect(log.beanPuts).toHaveLength(1);
  expect(log.beanPosts).toHaveLength(1);
});


test('bag photo, nickname, and distinct shortcuts survive selection and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1340, height: 800 });
  const log = await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.locator('[name="displayName"]').fill('Neta (Santo Domingo)');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await expect(page.locator('.stock-row')).toContainText('Neta (Santo Domingo)');
  expect(log.batchPosts[0]).toMatchObject({ extras: { beanie: { displayName: 'Neta (Santo Domingo)' } } });
  await page.locator('[data-action="toggle-batch-details"]').click();
  await page.locator('[name="bagIcon"]').selectOption('heart');
  await page.locator('[name="shortcutLabel"]').fill('Neta');
  await page.locator('.bean-picker-head h2').click();
  await expect(page.locator('[name="shortcutLabel"]')).toHaveValue('Neta');
  await expect(page.locator('input[capture="environment"]')).toHaveAttribute('accept', 'image/*');
  await page.locator('[data-action="bag-image-upload"]:not([capture])').setInputFiles({
    name: 'bag.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.locator('.bag-image-editor img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.locator('[data-action="toggle-favorite-bean"]').click();
  await page.locator('.bean-row').click();
  await expect(page.locator('.bean-picker-modal')).toHaveCount(0);
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await page.locator('[data-action="settings-bag-button-size"][data-value="large"]').click();
  await page.locator('[data-action="settings-bag-shortcuts"][data-value="favorites"]').click();
  await page.locator('[data-action="go-view"][data-value="workbench"]').first().click();
  const shortcut = page.locator('.hero-rotation-tile');
  await expect(shortcut).toHaveCount(1);
  await expect(shortcut).toHaveText('Neta');
  await expect(page.locator('img.hero-bag-image')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Favorites', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Other bags', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Profile presets', exact: true })).toBeVisible();
  await expect(page.locator('.hero-current-label')).toHaveText('Current bag');
  await page.getByRole('button', { name: 'Use profile Morning preset' }).click();
  await expect(page.locator('.hero-current-detail')).toContainText('Morning preset');
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  const size = await shortcut.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(48);
  const recipeBox = await page.locator('.recipe-grid').boundingBox();
  expect(size!.y + size!.height).toBeLessThanOrEqual(recipeBox!.y);
  await shortcut.click();
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  await page.screenshot({ path: testInfo.outputPath('bag-banner.png') });
  await page.reload();
  await expect(page.locator('.hero.large-bag-buttons')).toBeVisible();
  await expect(shortcut).toHaveCount(1);
  await expect(shortcut).toHaveText('Neta');
  await expect(page.locator('img.hero-bag-image')).toBeVisible();
});
