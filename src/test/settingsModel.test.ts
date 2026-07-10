import {
  SETTINGS_SPEC,
  coerceFieldValue,
  demoSettingsBundle,
  fieldValue,
  minutesToTime,
  setBundleField,
  type SettingsField
} from '../domain/settingsModel';

await run('numeric selects coerce raw control values to numbers', () => {
  const heaterVoltage = specField('advanced', 'heaterVoltage');
  const refillKit = specField('advanced', 'refillKitSetting');

  equal(heaterVoltage.valueType, 'number');
  equal(refillKit.valueType, 'number');
  equal(coerceFieldValue(heaterVoltage, '230'), 230);
  equal(coerceFieldValue(refillKit, '0'), 0);
  equal(coerceFieldValue(refillKit, '2'), 2);
  equal(coerceFieldValue(heaterVoltage, 'junk'), null);
});

await run('numeric select coercion patches a numeric value into the bundle', () => {
  const heaterVoltage = specField('advanced', 'heaterVoltage');
  const bundle = setBundleField(demoSettingsBundle(), heaterVoltage, coerceFieldValue(heaterVoltage, '230'));

  equal(bundle.advanced.heaterVoltage, 230);
  equal(typeof bundle.advanced.heaterVoltage, 'number');
  equal(fieldValue(bundle, heaterVoltage), '230');
});

await run('all select fields backed by numeric wire values declare a number value type', () => {
  const bundle = demoSettingsBundle();
  for (const section of SETTINGS_SPEC) {
    for (const field of section.fields) {
      if (field.type !== 'select' || field.valueType === 'number') continue;
      const wireValue = (bundle[field.group] as unknown as Record<string, unknown>)[field.key];
      if (typeof wireValue === 'number') {
        throw new Error(`Select field ${field.group}.${field.key} maps to a numeric wire value but stores strings`);
      }
    }
  }
});

await run('string selects keep coercing to strings', () => {
  const scalePowerMode = specField('rea', 'scalePowerMode');

  equal(coerceFieldValue(scalePowerMode, 'disconnect'), 'disconnect');
});

await run('toggle, number, and time fields coerce and clamp their raw values', () => {
  const toggle = specField('rea', 'blockOnNoScale');
  equal(coerceFieldValue(toggle, true), true);
  equal(coerceFieldValue(toggle, 'true'), true);
  equal(coerceFieldValue(toggle, 'false'), false);

  const number = specField('rea', 'weightFlowMultiplier');
  equal(coerceFieldValue(number, '0.5'), 0.5);
  equal(coerceFieldValue(number, '99'), 5);
  equal(coerceFieldValue(number, '-1'), 0);
  equal(coerceFieldValue(number, 'junk'), null);

  const time = specField('rea', 'nightModeSleepTime');
  equal(coerceFieldValue(time, '23:30'), 23 * 60 + 30);
  equal(coerceFieldValue(time, 'junk'), null);
});

await run('field value reads typed values out of the bundle per control type', () => {
  const bundle = demoSettingsBundle();

  equal(fieldValue(bundle, specField('rea', 'blockOnNoScale')), bundle.rea.blockOnNoScale === true);
  equal(fieldValue(bundle, specField('rea', 'weightFlowMultiplier')), bundle.rea.weightFlowMultiplier);
  equal(fieldValue(bundle, specField('rea', 'scalePowerMode')), String(bundle.rea.scalePowerMode));
  equal(fieldValue(setBundleField(bundle, specField('rea', 'scalePowerMode'), null), specField('rea', 'scalePowerMode')), '');
});

await run('minutes to time renders HH:MM and wraps out-of-range minutes', () => {
  equal(minutesToTime(0), '00:00');
  equal(minutesToTime(23 * 60 + 30), '23:30');
  equal(minutesToTime(1440 + 90), '01:30');
  equal(minutesToTime(null), '00:00');
});

function specField(group: string, key: string): SettingsField {
  for (const section of SETTINGS_SPEC) {
    const field = section.fields.find((item) => item.group === group && item.key === key);
    if (field) return field;
  }
  throw new Error(`Missing spec field ${group}.${key}`);
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
