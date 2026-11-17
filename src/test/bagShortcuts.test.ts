import { strict as assert } from 'node:assert';
import { rotationBeans } from '../domain/beanDisplay';
import { readSettingsPreferences, writeSettingsPreferencePatch } from '../domain/settings';
import { bagButtonSizeKey, bagShortcutsKey, clearSyncedCache, setStorePushHandler, setSyncedItem } from '../domain/settingsStore';
import type { Bean } from '../api/types';

const coffee: Bean = { id: 'coffee', roaster: 'Roaster', name: 'Original coffee' };
const other: Bean = { ...coffee, id: 'other' };
const input = {
  beans: [coffee, other, { ...coffee, id: 'archived', archived: true }], selectedBeanId: coffee.id,
  favoriteBeanIds: [coffee.id, 'deleted', 'archived', coffee.id], recentBeanIds: [other.id], beanUsageAt: {}, favoritesOnly: true
};
assert.deepEqual(rotationBeans(input).map((bean) => bean.id), [coffee.id]);
assert.deepEqual(rotationBeans({ ...input, selectedBeanId: other.id }).map((bean) => bean.id), [coffee.id]);
assert.deepEqual(rotationBeans({ ...input, favoriteBeanIds: [] }), []);
console.log('ok - favorite shortcuts keep selected favorites stable and omit deleted, archived, and recent coffees');

clearSyncedCache();
setStorePushHandler(null);
assert.equal(readSettingsPreferences().bagButtonSize, 'standard');
assert.equal(readSettingsPreferences().bagShortcuts, 'rotation');
writeSettingsPreferencePatch({ bagButtonSize: 'large', bagShortcuts: 'favorites' });
assert.equal(readSettingsPreferences().bagButtonSize, 'large');
assert.equal(readSettingsPreferences().bagShortcuts, 'favorites');
setSyncedItem(bagButtonSizeKey, 'invalid');
setSyncedItem(bagShortcutsKey, 'invalid');
assert.equal(readSettingsPreferences().bagButtonSize, 'standard');
assert.equal(readSettingsPreferences().bagShortcuts, 'rotation');
clearSyncedCache();
console.log('ok - bag shortcut preferences sync and reject unknown values');
