import { icon } from '../components/icons';
import { strict as assert } from 'node:assert';
import type { Bean, BeanBatch } from '../api/types';
import { COFFEE_ICONS, automaticCoffeeIcon, beanAppearanceExtras, beanDisplayName, beanIcon, beanImage, beanSavedImage } from '../domain/beanAppearance';
const bean: Bean = { id: 'coffee', name: 'Original', roaster: 'Roaster', extras: { otherSkin: { keep: true } } };
const bag: BeanBatch = { id: 'bag-1', beanId: bean.id, extras: { beanie: { displayName: 'Old nickname', shortcutLabel: 'Old short name', icon: 'heart', image: 'data:image/jpeg;base64,AAAA' } } };
const second = { ...bag, id: 'bag-2', extras: undefined };
const saved = { ...bean, extras: beanAppearanceExtras(bean, [bag], { displayName: 'Shared coffee' }) };
for (const selected of [bag, second]) {
  assert.equal(beanDisplayName(saved, [selected]), 'Shared coffee');
  assert.equal(beanIcon(saved, [selected]), 'heart');
  assert.equal(beanImage(saved, [selected]), 'data:image/jpeg;base64,AAAA');
}
assert.equal(saved.name, 'Original');
assert.deepEqual(saved.extras.otherSkin, { keep: true });
assert.equal((saved.extras.beanie as Record<string, unknown>).shortcutLabel, undefined);
assert.equal(beanIcon(bean, [bag, second]), beanIcon(bean, [second, bag]));
const cleared = { ...saved, extras: beanAppearanceExtras(saved, [bag], { displayName: null, image: null, icon: null }) };
assert.equal(beanDisplayName(cleared, [bag]), null);
assert.equal(beanImage(cleared, [bag]), null);
assert.equal(beanIcon(cleared, [bag]), beanIcon(cleared, [second]));
assert.equal(beanImage({ extras: { beanie: { image: 'data:image/svg+xml;base64,AAAA' } } }), null);
console.log('ok - coffee appearance is shared across bags, preserves legacy choices, and clears explicitly');

for (let i = 0; i < 100; i++) {
  assert.notEqual(automaticCoffeeIcon('coffee-' + i), 'heart');
  assert.equal(automaticCoffeeIcon('coffee-' + i, true), 'heart');
}
for (const name of COFFEE_ICONS) assert.ok(icon(name).startsWith('<svg'), 'Unregistered coffee icon: ' + name);
assert.equal(beanIcon(bean, [], true), 'heart');
assert.equal(beanIcon({ ...bean, extras: { beanie: { icon: 'sun' } } }, [], true), 'sun');
const iconMode = { ...saved, extras: beanAppearanceExtras(saved, [], { icon: 'leaf', appearanceMode: 'icon' }) };
assert.equal(beanImage(iconMode), null);
assert.equal(beanSavedImage(iconMode), 'data:image/jpeg;base64,AAAA');
const photoMode = { ...iconMode, extras: beanAppearanceExtras(iconMode, [], { appearanceMode: 'photo' }) };
assert.equal(beanImage(photoMode), 'data:image/jpeg;base64,AAAA');
console.log('ok - automatic hearts are favorite-only, icon choices render, and choosing an icon preserves the saved photo');
