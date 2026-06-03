import type { Workflow } from '../api/types';
import {
  DEFAULT_HOT_WATER,
  FLUSH_PRESETS,
  STEAM_PRESETS,
  clampFlush,
  clampHotWater,
  flushValues,
  hotWaterValues,
  matchingPreset,
  steamValues,
  waterControlCapabilities
} from '../domain/waterSettings';

const workflow: Workflow = {
  steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 },
  hotWaterData: { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
  rinseData: { targetTemperature: 90, duration: 10, flow: 6 }
};

run('uses live DE1 machine settings ahead of workflow values', () => {
  const settings = {
    steamFlow: 1.1,
    hotWaterFlow: 8.5,
    flushTemp: 88,
    flushFlow: 5.5,
    flushTimeout: 7
  };

  equal(steamValues(workflow, settings).flow, 1.1);
  equal(hotWaterValues(workflow, settings).flow, 8.5);
  match(flushValues(workflow, settings), { targetTemperature: 88, flow: 5.5, duration: 7 });
});

run('detects preset matches from the full Reaprime workflow shape', () => {
  equal(matchingPreset(STEAM_PRESETS[1]!.values, STEAM_PRESETS), 'medium-jug');
  equal(matchingPreset(FLUSH_PRESETS[1]!.values, FLUSH_PRESETS), 'standard');
  equal(matchingPreset({ ...DEFAULT_HOT_WATER, volume: 99 }, []), 'custom');
});

run('clamps settings to the Reaprime-backed control specs', () => {
  const caps = waterControlCapabilities({ settings: { steamFlow: 0.8 } });
  const water = clampHotWater(
    { targetTemperature: 120, duration: 999, volume: -20, flow: 30 },
    caps
  );
  const flush = clampFlush({ targetTemperature: -5, duration: 999, flow: 99 }, caps);

  match(water, { targetTemperature: 100, duration: 180, volume: 0, flow: 12 });
  match(flush, { targetTemperature: 0, duration: 120, flow: 12 });
});

run('keeps future milk-probe steam stop disabled until Reaprime exposes support', () => {
  const caps = waterControlCapabilities({
    capabilities: { capabilities: ['integratedScale', 'stopAtWeight'] },
    settings: { steamFlow: 0.8 }
  });

  equal(caps.source, 'machine');
  equal(caps.steam.stopAtTemperature?.enabled, false);
  equal(caps.hardware.includes('integratedScale'), true);
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

function match(actual: unknown, expected: Record<string, unknown>): void {
  if (actual == null || typeof actual !== 'object') {
    throw new Error('Expected an object');
  }
  const obj = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (obj[key] !== value) {
      throw new Error(`Expected ${key}=${String(value)}, received ${String(obj[key])}`);
    }
  }
}
