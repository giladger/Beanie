import { strict as assert } from 'node:assert';
import { bagDisplayName, bagIcon, bagImage, bagName, displayBatch, rotationBeans } from '../domain/beanDisplay';
import { batchInputFromSubmission } from '../domain/beanForm';
import { readSettingsPreferences, writeSettingsPreferencePatch } from '../domain/settings';
import { bagButtonSizeKey, bagShortcutsKey, clearSyncedCache, setStorePushHandler, setSyncedItem } from '../domain/settingsStore';
import type { Bean, BeanBatch } from '../api/types';

const coffee: Bean = { id: 'coffee', roaster: 'Roaster', name: 'Original coffee' };
const source: BeanBatch = {
  id: 'bag', beanId: coffee.id, roastDate: '2026-10-01', weight: 250, weightRemaining: 100,
  extras: { workflowSkin: { name: 'Original bag' }, beanie: { other: 'preserve' } }
};
const fields = {
  roastDate: source.roastDate!, roastLevel: null,
  weight: { present: false, value: null }, weightRemaining: { present: false, value: null }
};
const renamed = { ...source, ...batchInputFromSubmission({
  ...fields, displayName: { present: true, value: '  Neta (Santo Domingo)  ' }
}, coffee.id, source) };
assert.equal(bagName(coffee, renamed), 'Neta (Santo Domingo)');
assert.equal(coffee.name, 'Original coffee');
assert.deepEqual(renamed.extras, {
  workflowSkin: { name: 'Original bag' }, beanie: { other: 'preserve', displayName: 'Neta (Santo Domingo)' }
});
const cleared = { ...renamed, ...batchInputFromSubmission({
  ...fields, displayName: { present: true, value: '  ' }
}, coffee.id, renamed) };
assert.equal(bagName(coffee, cleared), coffee.name);
assert.equal(bagName(coffee, source), coffee.name);
assert.equal(batchInputFromSubmission(fields, coffee.id, renamed).extras, undefined);
assert.equal(bagDisplayName({ extras: { beanie: { displayName: 42 } } }), null);
assert.equal(bagDisplayName({ extras: { beanie: [] } }), null);
assert.equal(displayBatch([renamed, { ...source, id: 'finished', roastDate: '2026-11-01', weightRemaining: 0 }])?.id, renamed.id);
console.log('ok - per-bag display names trim, clear, and preserve other skin metadata');

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

assert.equal(bagIcon(source), bagIcon({ ...source }));
assert.equal(bagIcon({ ...source, extras: { beanie: { icon: 'heart' } } }), 'heart');
assert.equal(bagIcon({ ...source, extras: { beanie: { icon: '<script>' } } }), bagIcon(source));
assert.equal(bagImage({ extras: { beanie: { image: 'https://example.com/photo.jpg' } } }), null);
assert.equal(bagImage({ extras: { beanie: { image: 'data:image/svg+xml;base64,AAAA' } } }), null);
assert.equal(bagImage({ extras: { beanie: { image: 'data:image/jpeg;base64,AAAA' } } }), 'data:image/jpeg;base64,AAAA');
console.log('ok - each bag gets a stable default icon, with an optional choice or raster photo');
