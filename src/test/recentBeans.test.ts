import { readLastBeanId, readRecentBeanIds, writeLastBeanId } from '../domain/storage';
import { clearSyncedCache, getSyncedItem, recentBeansKey, setSyncedItem } from '../domain/settingsStore';

run('writeLastBeanId keeps a most-recent-first selection history', () => {
  clearSyncedCache();
  writeLastBeanId('a');
  writeLastBeanId('b');
  writeLastBeanId('c');
  equal(readLastBeanId(), 'c');
  equal(readRecentBeanIds().join(','), 'c,b,a');

  // Re-selecting moves a bean to the front instead of duplicating it.
  writeLastBeanId('a');
  equal(readRecentBeanIds().join(','), 'a,c,b');
  clearSyncedCache();
});

run('the selection history is capped and survives malformed store values', () => {
  clearSyncedCache();
  for (let index = 0; index < 12; index += 1) writeLastBeanId(`bean-${index}`);
  equal(readRecentBeanIds().length, 8);
  equal(readRecentBeanIds()[0], 'bean-11');

  setSyncedItem(recentBeansKey, 'not json');
  equal(readRecentBeanIds().join(','), '');
  // A bad stored value never breaks the write path.
  writeLastBeanId('fresh');
  equal(readRecentBeanIds().join(','), 'fresh');

  setSyncedItem(recentBeansKey, JSON.stringify(['ok', 7, null, 'also-ok']));
  equal(readRecentBeanIds().join(','), 'ok,also-ok');
  equal(typeof getSyncedItem(recentBeansKey), 'string');
  clearSyncedCache();
});

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
