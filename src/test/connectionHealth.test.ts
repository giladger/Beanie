import { reconnectDelayMs } from '../domain/connectionHealth';

run('reconnect delay backs off exponentially and caps at 15s', () => {
  equal(reconnectDelayMs(0), 1000);
  equal(reconnectDelayMs(1), 2000);
  equal(reconnectDelayMs(2), 4000);
  equal(reconnectDelayMs(3), 8000);
  equal(reconnectDelayMs(4), 15000);
  equal(reconnectDelayMs(100), 15000);
});

run('reconnect delay tolerates bogus attempt counts', () => {
  equal(reconnectDelayMs(-3), 1000);
  equal(reconnectDelayMs(Number.NaN), 1000);
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
