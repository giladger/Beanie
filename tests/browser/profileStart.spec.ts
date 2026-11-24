import { expect, test } from '@playwright/test';
import type { Workflow } from '../../src/api/types';

test('waking a restored Adaptive recipe starts Adaptive instead of the previous Filter workflow', async ({ page }) => {
  const selectedBean = { id: 'nahat', name: 'Nahat 58', roaster: 'Nahat' };
  const oldBean = { id: 'filter-beans', name: 'Filter beans', roaster: 'Test' };
  const adaptive: Workflow = {
    profile: { title: 'Adaptive v3', target_weight: 40, tank_temperature: 94, steps: [{ name: 'Fill' }] },
    context: { beanId: selectedBean.id, beanBatchId: 'nahat-bag', targetDoseWeight: 20, targetYield: 40 }
  };
  let currentWorkflow: Workflow = {
    profile: { title: 'Filter3', target_weight: 0, tank_temperature: 94, steps: [{ name: 'Bloom' }] },
    context: { beanId: oldBean.id, beanBatchId: 'old-bag', targetDoseWeight: 20, targetYield: 0 }
  };
  const shot = {
    id: 'adaptive-shot', timestamp: '2026-11-20T08:30:00Z', workflow: adaptive,
    annotations: { actualDoseWeight: 20, actualYield: 43.4 }, measurements: []
  };
  const writes: Workflow[] = [];
  const starts: Workflow[] = [];
  let machineState = 'sleeping';
  await page.routeWebSocket('**/ws/v1/**', () => {});
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value)
    });
    if (path === '/api/v1/workflow') {
      if (request.method() === 'PUT') {
        currentWorkflow = request.postDataJSON() as Workflow;
        writes.push(currentWorkflow);
      }
      return json(currentWorkflow);
    }
    if (path === '/api/v1/beans') return json([selectedBean, oldBean]);
    if (path.endsWith('/batches')) {
      const beanId = path.split('/')[4]!;
      return json([{ id: beanId === selectedBean.id ? 'nahat-bag' : 'old-bag', beanId }]);
    }
    if (path === '/api/v1/profiles') return json([{ id: 'adaptive', profile: adaptive.profile }]);
    if (path === '/api/v1/grinders') return json([]);
    if (path === '/api/v1/shots') return json({ items: [shot], total: 1, limit: 50, offset: 0 });
    if (path === '/api/v1/shots/adaptive-shot') return json(shot);
    if (path === '/api/v1/machine/info') return json({ serialNumber: 'simulator-1', model: 'DE1' });
    if (path === '/api/v1/machine/state') return json({ state: { state: machineState } });
    if (path.startsWith('/api/v1/machine/state/')) {
      machineState = path.split('/').at(-1)!;
      if (machineState === 'espresso') starts.push(structuredClone(currentWorkflow));
      return json({});
    }
    if (path === '/api/v1/store/beanie') return json({ 'beanie.settings.screensaver-mode': '"system"' });
    if (path.startsWith('/api/v1/store/beanie/')) return json(null);
    if (path === '/api/v1/machine/capabilities') return json({ capabilities: [] });
    if (path === '/api/v1/devices' || path === '/api/v1/plugins' || path === '/api/v1/webui/skins') return json([]);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await expect(page.locator('.profile-button')).toContainText('Adaptive v3');
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Wake', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Shot', exact: true }).click();

  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0]?.profile?.title).toBe('Adaptive v3');
  expect(starts[0]?.profile?.steps).toEqual([{ name: 'Fill' }]);
  expect(starts[0]?.context?.targetYield).toBe(40);
  expect(starts[0]?.context?.beanId).toBe(selectedBean.id);
  expect(writes.at(-1)?.profile?.title).toBe('Adaptive v3');
});
