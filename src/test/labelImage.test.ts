import { scaledDimensions } from '../domain/labelImage';

run('scales a large landscape photo to fit the long edge', () => {
  const { width, height } = scaledDimensions(4000, 3000, 1280);
  equal(width, 1280);
  equal(height, 960);
});

run('scales a large portrait photo by its long (vertical) edge', () => {
  const { width, height } = scaledDimensions(3000, 4000, 1280);
  equal(width, 960);
  equal(height, 1280);
});

run('never upscales an already-small photo', () => {
  const { width, height } = scaledDimensions(800, 600, 1280);
  equal(width, 800);
  equal(height, 600);
});

run('returns zero dimensions for non-positive input', () => {
  const { width, height } = scaledDimensions(0, 500, 1280);
  equal(width, 0);
  equal(height, 0);
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
