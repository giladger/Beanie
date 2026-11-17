import { strict as assert } from 'node:assert';
import type { Bean, BeanBatch } from '../api/types';
import { beanAppearanceExtras, beanDisplayName, beanIcon, beanImage, beanShortcutLabel } from '../domain/beanAppearance';
const bean: Bean = { id: 'coffee', name: 'Original', roaster: 'Roaster', extras: { otherSkin: { keep: true } } };
const bag: BeanBatch = { id: 'bag-1', beanId: bean.id, extras: { beanie: { displayName: 'Old nickname', icon: 'heart', image: 'data:image/jpeg;base64,AAAA' } } };
const second = { ...bag, id: 'bag-2', extras: undefined };
const saved = { ...bean, extras: beanAppearanceExtras(bean, [bag], { displayName: 'Shared coffee', shortcutLabel: 'Shared' }) };
for (const selected of [bag, second]) {
  assert.equal(beanDisplayName(saved, [selected]), 'Shared coffee');
  assert.equal(beanIcon(saved, [selected]), 'heart');
  assert.equal(beanImage(saved, [selected]), 'data:image/jpeg;base64,AAAA');
}
assert.equal(saved.name, 'Original');
assert.deepEqual(saved.extras.otherSkin, { keep: true });
assert.equal(beanShortcutLabel(saved), 'Shared');
assert.equal(beanIcon(bean, [bag, second]), beanIcon(bean, [second, bag]));
const cleared = { ...saved, extras: beanAppearanceExtras(saved, [bag], { displayName: null, image: null, icon: null }) };
assert.equal(beanDisplayName(cleared, [bag]), null);
assert.equal(beanImage(cleared, [bag]), null);
assert.equal(beanIcon(cleared, [bag]), beanIcon(cleared, [second]));
assert.equal(beanImage({ extras: { beanie: { image: 'data:image/svg+xml;base64,AAAA' } } }), null);
console.log('ok - coffee appearance is shared across bags, preserves legacy choices, and clears explicitly');
