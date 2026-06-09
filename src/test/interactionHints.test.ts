import {
  markSecondTapHintUsed,
  secondTapHintUsesBeforeHiding,
  shouldShowSecondTapHint
} from '../domain/interactionHints';

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new FakeStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: storage
});

run('second tap hints show by default', () => {
  storage.clear();

  equal(shouldShowSecondTapHint('bean'), true);
  equal(shouldShowSecondTapHint('shot'), true);
});

run('hint stays visible until used the configured number of times', () => {
  storage.clear();

  for (let i = 0; i < secondTapHintUsesBeforeHiding - 1; i += 1) {
    markSecondTapHintUsed('bean');
    equal(shouldShowSecondTapHint('bean'), true);
  }

  markSecondTapHintUsed('bean');
  equal(shouldShowSecondTapHint('bean'), false);
});

run('counting one hint up does not affect the other', () => {
  storage.clear();

  for (let i = 0; i < secondTapHintUsesBeforeHiding; i += 1) {
    markSecondTapHintUsed('bean');
  }

  equal(shouldShowSecondTapHint('bean'), false);
  equal(shouldShowSecondTapHint('shot'), true);
});

run('malformed hint preferences recover to defaults', () => {
  storage.clear();
  localStorage.setItem('beanie:second-tap-hint-v3', '{');

  equal(shouldShowSecondTapHint('bean'), true);
  equal(shouldShowSecondTapHint('shot'), true);
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
