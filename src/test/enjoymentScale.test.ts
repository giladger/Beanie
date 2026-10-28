import { ENJOYMENT_MAX, normalizeEnjoyment } from '../domain/enjoymentScale';

run('normalizeEnjoyment passes gateway 0-10 ratings through and drops unrated shots', () => {
  equal(ENJOYMENT_MAX, 10);
  equal(normalizeEnjoyment(null), null);
  equal(normalizeEnjoyment(undefined), null);
  equal(normalizeEnjoyment(0), null);
  equal(normalizeEnjoyment(-1), null);
  equal(normalizeEnjoyment(Number.NaN), null);
  equal(normalizeEnjoyment(2), 2);
  equal(normalizeEnjoyment(7.5), 7.5);
  equal(normalizeEnjoyment(10), 10);
});

run('normalizeEnjoyment rescales 0-100 ratings from gateways older than Decaid 0.8.7', () => {
  equal(normalizeEnjoyment(20), 2);
  equal(normalizeEnjoyment(74), 7.4);
  equal(normalizeEnjoyment(80), 8);
  equal(normalizeEnjoyment(100), 10);
  equal(normalizeEnjoyment(150), 10);
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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
