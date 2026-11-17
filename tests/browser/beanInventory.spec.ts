import { demoShotsForBean } from '../../src/mock/demo';
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
  readonly displayCommands: Array<{ command: string }>;
}

async function fakeGateway(page: Page): Promise<GatewayLog> {
  const log: GatewayLog = { beanPosts: [], batchPosts: [], beanPuts: [], displayCommands: [] };
  const beans: Record<string, unknown>[] = [];
  const batches: Record<string, Record<string, unknown>[]> = {};
  const store: Record<string, unknown> = { 'beanie.favorite-profiles': '["preset-1"]' };
  let beanSeq = 0;
  let batchSeq = 0;

  await page.routeWebSocket('**/ws/v1/**', (socket) => {
    socket.onMessage((message) => {
      if (!socket.url().endsWith('/display')) return;
      try { log.displayCommands.push(JSON.parse(String(message)) as { command: string }); } catch { /* No-op for non-JSON frames. */ }
    });
  });
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


test('shared coffee appearance and distinct shortcuts survive selection, new bags, and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1340, height: 800 });
  const log = await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.locator('[name="displayName"]').fill('Neta (Santo Domingo)');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await expect(page.locator('.bean-row')).toContainText('Neta (Santo Domingo)');
  expect(log.beanPosts[0]).toMatchObject({ extras: { beanie: { displayName: 'Neta (Santo Domingo)' } } });
  await page.getByRole('button', { name: 'Edit coffee', exact: true }).click();
  await page.getByRole('button', { name: 'Use Heart icon', exact: true }).click();
  await expect(page.locator('.bean-row-image [data-icon="heart"]')).toBeVisible();
  await expect(page.locator('.coffee-icon-choice[data-value="heart"] [data-icon="heart"]')).toBeVisible();
  await expect(page.locator('.coffee-icon-choice[data-value="heart"] [data-icon="heart"]')).toHaveCSS('fill', 'rgb(237, 121, 149)');
  await expect(page.locator('[name="shortcutLabel"]')).toHaveCount(0);
  await expect(page.locator('input[capture="environment"]')).toHaveAttribute('accept', 'image/*');
  await page.locator('[data-action="bean-image-upload"]:not([capture])').setInputFiles({
    name: 'coffee.jpg', mimeType: 'image/jpeg',
    buffer: await import('node:fs/promises').then((fs) => fs.readFile(new URL('../fixtures/coffee.jpg', import.meta.url)))
  });
  await expect(page.locator('.bag-image-editor img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.locator('.bean-row-image img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.screenshot({ path: testInfo.outputPath('coffee-appearance-editor.png') });
  await page.locator('[data-action="toggle-favorite-bean"]').click();
  await page.locator('.bean-row').click();
  await expect(page.locator('.bean-picker-modal')).toHaveCount(0);
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  await page.getByRole('button', { name: 'Change coffee icon or photo', exact: true }).click();
  await expect(page.locator('[name="coffeeIcon"]')).toHaveValue('heart');
  await expect(page.getByRole('group', { name: 'Coffee icons', exact: true }).getByRole('button')).toHaveCount(26);
  await page.locator('[data-action="bean-picker-add-batch"]').click();
  await page.getByRole('button', { name: 'Add bag', exact: true }).click();
  await expect(page.locator('.stock-row')).toHaveCount(2);
  await page.locator('.stock-row[data-id="batch-2"]').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  await expect(page.locator('img.hero-bag-image')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await page.locator('[data-action="settings-bag-button-size"][data-value="large"]').click();
  await page.locator('[data-action="settings-bag-shortcuts"][data-value="favorites"]').click();
  await page.locator('[data-action="go-view"][data-value="workbench"]').first().click();
  const shortcut = page.locator('.hero-rotation-tile');
  await expect(shortcut).toHaveCount(1);
  await expect(shortcut).toHaveText('Neta (Santo Domingo)');
  await expect(page.locator('img.hero-bag-image')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Favorites', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Other bags', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Profile presets', exact: true })).toBeVisible();
  await expect(page.locator('.hero-current-label')).toHaveText('Current bag');
  await page.getByRole('button', { name: 'Use profile Morning preset' }).click();
  await expect(page.locator('.hero-current-detail')).toContainText('Morning preset');
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  const size = await shortcut.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(64);
  const favoriteArea = await page.getByRole('group', { name: 'Favorites', exact: true }).locator('.hero-shortcut-buttons').boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(favoriteArea!.width - 1);
  const recipeBox = await page.locator('.recipe-grid').boundingBox();
  expect(size!.y + size!.height).toBeLessThanOrEqual(recipeBox!.y);
  await page.setViewportSize({ width: 1006, height: 600 });
  expect((await shortcut.boundingBox())!.height).toBeLessThanOrEqual(50);
  expect((await page.locator('.hero').boundingBox())!.height).toBeLessThanOrEqual(100);
  await page.setViewportSize({ width: 1340, height: 800 });
  await shortcut.click();
  await expect(page.locator('.bean-name')).toHaveText('Neta (Santo Domingo)');
  await page.screenshot({ path: testInfo.outputPath('bag-banner.png') });
  await page.reload();
  await expect(page.locator('.hero.large-bag-buttons')).toBeVisible();
  await expect(shortcut).toHaveCount(1);
  await expect(shortcut).toHaveText('Neta (Santo Domingo)');
  await expect(page.locator('img.hero-bag-image')).toBeVisible();
});


test('uploaded coffee photo appears in Other bags before that coffee is selected', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1006, height: 600 });
  await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.locator('[name="displayName"]').fill('Morning roast');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await page.getByRole('button', { name: 'Edit coffee', exact: true }).click();
  await page.locator('[data-action="bean-image-upload"]:not([capture])').setInputFiles({
    name: 'coffee.jpg', mimeType: 'image/jpeg',
    buffer: await import('node:fs/promises').then((fs) => fs.readFile(new URL('../fixtures/coffee.jpg', import.meta.url)))
  });
  await expect(page.locator('.bag-image-editor img')).toBeVisible();
  await page.locator('.bean-row').click();
  await openCreateForm(page);
  await page.locator('[name="name"]').fill('Second coffee');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await expect(page.locator('.bean-row-image img')).toHaveCount(1);
  await expect(page.locator('.bean-row-image svg')).toHaveCount(1);
  const imageBox = await page.locator('.bean-row-image img').boundingBox();
  const textBox = await page.locator('.bean-row').first().locator('.bean-row-copy').boundingBox();
  expect(textBox!.x - (imageBox!.x + imageBox!.width)).toBeLessThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath('coffee-picker-images.png') });
  await page.locator('.bean-row[data-id="bean-2"]').click();
  await expect(page.locator('.bean-name')).toHaveText('Second coffee');
  const other = page.getByRole('group', { name: 'Other bags', exact: true }).getByRole('button', { name: 'Switch to Morning roast' });
  await expect(other.locator('img.hero-shortcut-image')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.screenshot({ path: testInfo.outputPath('other-bags-photo.png') });
});


test('Android screensaver mode releases the tablet wake-lock claim', async ({ page }) => {
  const log = await fakeGateway(page);
  await page.goto('/');
  await expect.poll(() => log.displayCommands.some((frame) => frame.command === 'requestWakeLock')).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await page.locator('[data-action="settings-screensaver-mode"][data-value="system"]').click();
  await expect.poll(() => log.displayCommands.at(-1)?.command).toBe('releaseWakeLock');
});


test('shot rating stays visible with long profile text and Derek notes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1006, height: 600 });
  await fakeGateway(page);
  const shot = demoShotsForBean({ id: 'bean-1', roaster: 'Test', name: 'Test' })[0]!;
  shot.id = 'rated-shot';
  shot.workflow!.context = { ...shot.workflow!.context, beanId: 'bean-1', beanBatchId: 'batch-1' };
  shot.workflow!.profile = { ...shot.workflow!.profile!, title: 'Neta - Gentle and sweet with a very long profile name (17g to 35g)' };
  shot.annotations = { ...shot.annotations, enjoyment: 8, extras: { derekTweak: 'Example saved tip' } };
  await page.route('**/api/v1/shots**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(new URL(route.request().url()).pathname === '/api/v1/shots'
      ? { items: [shot], total: 1, limit: 24, offset: 0 } : shot)
  }));
  await page.goto('/');
  await openCreateForm(page);
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await page.locator('.bean-row').click();
  const row = page.locator('.shot-item[data-id="rated-shot"]');
  const rating = row.locator('.enjoyment-badge');
  await expect(rating).toHaveText('Good');
  await expect(rating).toBeInViewport();
  const bounds = await rating.boundingBox();
  const list = await page.locator('.shot-list').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(list!.x + list!.width);
  expect(await page.locator('.shot-list').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('visible-shot-rating.png') });
});

test('favorite fills its section and shows a filled heart', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1340, height: 800 });
  await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.locator('[name="displayName"]').fill('Neta');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await page.getByRole('button', { name: 'Edit coffee', exact: true }).click();
  await page.getByRole('button', { name: 'Use Heart icon', exact: true }).click();
  await expect(page.locator('.coffee-icon-choice[data-value="heart"] [data-icon="heart"]')).toBeVisible();
  await page.locator('[data-action="toggle-favorite-bean"]').click();
  await page.locator('.bean-row').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await page.locator('[data-action="settings-bag-button-size"][data-value="large"]').click();
  await page.locator('[data-action="go-view"][data-value="workbench"]').first().click();
  const group = page.getByRole('group', { name: 'Favorites', exact: true });
  const button = group.getByRole('button', { name: 'Switch to Neta', exact: true });
  await expect(button.locator('[data-icon="heart"]')).toHaveCSS('fill', 'rgb(237, 121, 149)');
  const card = await button.boundingBox();
  const available = await group.locator('.hero-shortcut-buttons').boundingBox();
  expect(card!.width).toBeGreaterThanOrEqual(available!.width - 1);
  expect(card!.height).toBeGreaterThanOrEqual(64);
  await page.locator('.hero').screenshot({ path: testInfo.outputPath('favorite-heart.png') });
});


test('visual icon choices use hearts automatically only for favorites and preserve saved photos', async ({ page }, testInfo) => {
  await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.getByRole('button', { name: 'Use Leaf icon', exact: true }).click();
  await expect(page.locator('[name="coffeeIcon"]')).toHaveValue('leaf');
  await page.evaluate(() => fetch('/api/v1/store/beanie/beanie.settings.cafe-name', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('Draft icon check')
  }));
  await expect(page.locator('.cafe-header-full .cafe-header-title')).toHaveText('Draft icon check', { timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Use Leaf icon', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[name="coffeeIcon"]')).toHaveValue('leaf');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await expect(page.locator('.bean-row-image [data-icon="leaf"]')).toBeVisible();
  await page.getByRole('button', { name: 'Edit coffee', exact: true }).click();
  const automatic = page.getByRole('button', { name: 'Use Automatic icon', exact: true });
  await automatic.click();
  await expect(page.locator('[name="coffeeIcon"]')).toHaveValue('');
  await expect(page.locator('.bean-row-image [data-icon="heart"]')).toHaveCount(0);
  await page.locator('[data-action="toggle-favorite-bean"]').click();
  await expect(automatic.locator('[data-icon="heart"]')).toBeVisible();
  await expect(page.locator('.bean-row-image [data-icon="heart"]')).toBeVisible();
  await page.getByRole('button', { name: 'Use Sun icon', exact: true }).click();
  await expect(page.locator('.bean-row-image [data-icon="sun"]')).toBeVisible();
  await page.locator('[data-action="toggle-favorite-bean"]').click();
  await expect(page.locator('.bean-row-image [data-icon="sun"]')).toBeVisible();
  await automatic.click();
  await expect(page.locator('.bean-row-image [data-icon="heart"]')).toHaveCount(0);
  await page.locator('[data-action="bean-image-upload"]:not([capture])').setInputFiles({
    name: 'coffee.jpg', mimeType: 'image/jpeg',
    buffer: await import('node:fs/promises').then((fs) => fs.readFile(new URL('../fixtures/coffee.jpg', import.meta.url)))
  });
  await expect(page.locator('.bean-row-image img')).toBeVisible();
  await page.getByRole('button', { name: 'Use Mountain icon', exact: true }).click();
  await expect(page.locator('.bean-row-image [data-icon="mountain"]')).toBeVisible();
  await expect(page.locator('.bean-row-image img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use saved coffee photo', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('coffee-icon-choices.png') });
  await page.getByRole('button', { name: 'Use saved coffee photo', exact: true }).click();
  await expect(page.locator('.bean-row-image img')).toBeVisible();
});


test('custom cafe header fits the existing banner, links to settings, and survives reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1340, height: 800 });
  await fakeGateway(page);
  await page.goto('/');
  await openCreateForm(page);
  await page.locator('[name="displayName"]').fill('Neta (Santo Domingo)');
  await page.getByRole('button', { name: 'Add coffee', exact: true }).click();
  await page.locator('.bean-row').click();
  const before = await page.locator('.hero').boundingBox();
  await expect(page.locator('.cafe-header')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App', exact: true }).click();
  await page.getByRole('textbox', { name: 'Café name', exact: true }).fill("Omer's Cafe");
  await page.getByRole('textbox', { name: 'Café name', exact: true }).press('Tab');
  await page.locator('[data-action="go-view"][data-value="workbench"]').first().click();
  await expect(page.locator('.cafe-header-full .cafe-header-title')).toHaveText("Omer's Cafe");
  const after = await page.locator('.hero').boundingBox();
  expect(after!.height).toBeLessThanOrEqual(before!.height + 1);
  await page.locator('.hero').screenshot({ path: testInfo.outputPath('cafe-header.png') });
  await page.locator('.cafe-header-full').click();
  await expect(page.getByRole('textbox', { name: 'Café name', exact: true })).toHaveValue("Omer's Cafe");
  await page.locator('[data-action="go-view"][data-value="workbench"]').first().click();
  await page.reload();
  await expect(page.locator('.cafe-header-full .cafe-header-title')).toHaveText("Omer's Cafe");
  await page.setViewportSize({ width: 1006, height: 600 });
  await expect(page.locator('.cafe-header-full')).toBeHidden();
  await expect(page.locator('.cafe-header-compact')).toBeVisible();
  expect((await page.locator('.hero').boundingBox())!.height).toBeLessThanOrEqual(100);
});
