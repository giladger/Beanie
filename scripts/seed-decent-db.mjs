#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gateway = (process.env.DECENT_GATEWAY ?? 'http://localhost:8080').replace(/\/$/, '');
const dbPath =
  process.env.DECENT_DB ??
  path.join(
    os.homedir(),
    'Library/Containers/net.tadel.reaprime/Data/Documents/streamline_bridge.sqlite'
  );

const grinders = [
  {
    model: 'DF64 Gen 2',
    burrs: 'SSP MP',
    burrSize: 64,
    burrType: 'flat',
    settingSmallStep: 0.1,
    settingBigStep: 0.5
  },
  {
    model: 'Niche Zero',
    burrs: 'Mazzer Kony',
    burrSize: 63,
    burrType: 'conical',
    settingSmallStep: 0.5,
    settingBigStep: 2
  },
  {
    model: 'Zerno Z1',
    burrs: 'Blind burrs',
    burrSize: 64,
    burrType: 'flat',
    settingSmallStep: 0.05,
    settingBigStep: 0.25
  }
];

const beans = [
  {
    roaster: 'Kawa',
    name: 'Pink Bourbon',
    country: 'Colombia',
    region: 'Huila',
    producer: 'Rodrigo Sanchez',
    processing: 'washed',
    variety: ['Pink Bourbon'],
    altitude: [1750, 1900],
    notes: 'red berries, panela, clean finish',
    roastLevel: 'light',
    weight: 250,
    baseDose: 18,
    baseYield: 42,
    grind: 6.1,
    profile: 'Blooming Espresso',
    grinder: 'DF64 Gen 2'
  },
  {
    roaster: 'Tsukcafe',
    name: 'Tore Badiya Anaerobic',
    country: 'Ethiopia',
    region: 'Guji',
    producer: 'Tore Badiya',
    processing: 'anaerobic natural',
    variety: ['74110', '74112'],
    altitude: [2000, 2200],
    notes: 'orange, cocoa, light florals',
    roastLevel: 'light',
    weight: 250,
    baseDose: 18,
    baseYield: 40,
    grind: 5.5,
    profile: 'Default',
    grinder: 'DF64 Gen 2'
  },
  {
    roaster: 'Nomad',
    name: 'Kenya Kamwangi',
    country: 'Kenya',
    region: 'Kirinyaga',
    producer: 'Kamwangi Factory',
    processing: 'washed',
    variety: ['SL28', 'SL34'],
    altitude: [1700, 1800],
    notes: 'blackcurrant, tomato leaf, sparkling',
    roastLevel: 'light',
    weight: 250,
    baseDose: 17.5,
    baseYield: 43,
    grind: 6.8,
    profile: 'Damian\'s LRv3',
    grinder: 'Zerno Z1'
  },
  {
    roaster: 'Square Mile',
    name: 'Sweetshop',
    country: 'Rwanda',
    region: 'Nyamasheke',
    producer: 'Gitwe',
    processing: 'washed',
    variety: ['Red Bourbon'],
    altitude: [1750, 1950],
    notes: 'stone fruit, caramel, sweet tea',
    roastLevel: 'medium-light',
    weight: 350,
    baseDose: 18.5,
    baseYield: 39,
    grind: 17,
    profile: 'Baseline • Medium Contact • 6 Bar',
    grinder: 'Niche Zero'
  },
  {
    roaster: 'April',
    name: 'Ethiopia Nano Genji',
    country: 'Ethiopia',
    region: 'Jimma',
    producer: 'Nano Genji',
    processing: 'washed',
    variety: ['Heirloom'],
    altitude: [1900, 2100],
    notes: 'bergamot, peach, tea-like',
    roastLevel: 'light',
    weight: 200,
    baseDose: 18,
    baseYield: 45,
    grind: 5.9,
    profile: 'Blooming Allongé',
    grinder: 'DF64 Gen 2'
  },
  {
    roaster: 'Tim Wendelboe',
    name: 'Caballero',
    country: 'Honduras',
    region: 'Marcala',
    producer: 'Marysabel Caballero',
    processing: 'washed',
    variety: ['Catuai'],
    altitude: [1500, 1650],
    notes: 'hazelnut, red apple, round sweetness',
    roastLevel: 'medium-light',
    weight: 250,
    baseDose: 18,
    baseYield: 37,
    grind: 16.5,
    profile: 'Default',
    grinder: 'Niche Zero'
  },
  {
    roaster: 'Onyx',
    name: 'Monarch',
    country: 'Blend',
    processing: 'washed / natural',
    variety: ['Bourbon', 'Catuai'],
    notes: 'dark chocolate, molasses, berries',
    roastLevel: 'medium',
    weight: 340,
    baseDose: 19,
    baseYield: 38,
    grind: 18,
    profile: 'Classic Italian espresso',
    grinder: 'Niche Zero'
  },
  {
    roaster: 'Friedhats',
    name: 'El Diviso Sidra',
    country: 'Colombia',
    region: 'Huila',
    producer: 'Nestor Lasso',
    processing: 'thermal shock washed',
    variety: ['Sidra'],
    altitude: [1750, 1800],
    notes: 'tropical candy, lime, creamy',
    roastLevel: 'light',
    weight: 250,
    baseDose: 18,
    baseYield: 44,
    grind: 5.3,
    profile: 'Adaptive v2',
    grinder: 'Zerno Z1'
  },
  {
    roaster: 'Calendar',
    name: 'La Danta',
    country: 'Costa Rica',
    region: 'Tarrazú',
    producer: 'La Danta',
    processing: 'honey',
    variety: ['Caturra', 'Catuai'],
    altitude: [1700, 1850],
    notes: 'yellow plum, honey, soft acidity',
    roastLevel: 'light',
    weight: 250,
    baseDose: 18,
    baseYield: 41,
    grind: 6.35,
    profile: 'Best practice (light roast)',
    grinder: 'DF64 Gen 2'
  },
  {
    roaster: 'Gardelli',
    name: 'Mzungu Project',
    country: 'Burundi',
    region: 'Kayanza',
    producer: 'Mbirizi Station',
    processing: 'natural',
    variety: ['Bourbon'],
    altitude: [1800, 1950],
    notes: 'strawberry jam, cacao nib, syrupy',
    roastLevel: 'light-medium',
    weight: 250,
    baseDose: 18.2,
    baseYield: 39.5,
    grind: 5.75,
    profile: 'Extractamundo Dos!',
    grinder: 'Zerno Z1'
  }
];

const notes = [
  'sweet center, clean finish',
  'a touch sharp, grind one click finer',
  'best cup of the bag so far',
  'opened up after a longer ratio',
  'nice body, slightly drying finish',
  'clear aromatics, keep this preset'
];

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function shotSeed(bean, index) {
  const basis = `${bean.roaster}:${bean.name}:${index}`;
  let n = 0;
  for (const ch of basis) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n / 0xffffffff;
}

async function json(pathname, init) {
  const res = await fetch(`${gateway}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} failed with ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function ensureGrinders() {
  const existing = await json('/api/v1/grinders?includeArchived=false');
  const byModel = new Map(existing.map((grinder) => [grinder.model, grinder]));
  for (const grinder of grinders) {
    if (!byModel.has(grinder.model)) {
      const created = await json('/api/v1/grinders', {
        method: 'POST',
        body: JSON.stringify({
          ...grinder,
          settingType: 'numeric',
          extras: { source: 'beanie-seed' }
        })
      });
      byModel.set(created.model, created);
    }
  }
  return byModel;
}

async function ensureBeansAndBatches() {
  const existing = await json('/api/v1/beans?includeArchived=false');
  const byName = new Map(existing.map((bean) => [`${bean.roaster}\0${bean.name}`, bean]));
  const batchesByBean = new Map();

  for (const bean of beans) {
    const key = `${bean.roaster}\0${bean.name}`;
    let record = byName.get(key);
    if (!record) {
      record = await json('/api/v1/beans', {
        method: 'POST',
        body: JSON.stringify({
          roaster: bean.roaster,
          name: bean.name,
          country: bean.country,
          region: bean.region,
          producer: bean.producer,
          processing: bean.processing,
          variety: bean.variety,
          altitude: bean.altitude,
          notes: bean.notes,
          extras: { source: 'beanie-seed' }
        })
      });
      byName.set(key, record);
    }

    const batches = await json(`/api/v1/beans/${encodeURIComponent(record.id)}/batches?includeArchived=false`);
    const seedKey = `${slug(bean.roaster)}-${slug(bean.name)}`;
    let batch = batches.find((item) => item.extras?.seedKey === seedKey);
    if (!batch) {
      const roastDate = daysAgo(4 + beans.indexOf(bean) * 3);
      batch = await json(`/api/v1/beans/${encodeURIComponent(record.id)}/batches`, {
        method: 'POST',
        body: JSON.stringify({
          roastDate,
          roastLevel: bean.roastLevel,
          weight: bean.weight,
          openDate: daysAgo(1 + beans.indexOf(bean)),
          notes: 'Seeded tasting bag for Beanie workflow development.',
          extras: { source: 'beanie-seed', seedKey }
        })
      });
    }
    batchesByBean.set(record.id, batch);
    Object.assign(bean, { id: record.id, batchId: batch.id });
  }
  return { byName, batchesByBean };
}

async function loadProfiles() {
  const records = await json('/api/v1/profiles?visibility=visible');
  const byTitle = new Map(records.map((record) => [record.profile.title, record.profile]));
  const fallback = byTitle.get('Default') ?? records[0]?.profile ?? {
    version: '1.0',
    title: 'Default',
    notes: 'Seed fallback profile',
    author: 'Decent',
    beverage_type: 'espresso',
    steps: [
      {
        name: 'Free flow',
        pump: 'pressure',
        transition: 'fast',
        exit: null,
        volume: 0,
        seconds: 120,
        weight: null,
        temperature: 90,
        sensor: 'coffee',
        pressure: 7.5,
        limiter: null
      }
    ],
    target_volume: null,
    target_weight: null,
    target_volume_count_start: 0,
    tank_temperature: 0
  };
  return { byTitle, fallback };
}

function pickProfile(profileMap, fallback, title) {
  return (
    profileMap.get(title) ??
    profileMap.get('Default') ??
    profileMap.get('Blooming Espresso') ??
    fallback
  );
}

function daysAgo(days, extraMinutes = 0) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - extraMinutes * 60 * 1000).toISOString();
}

function defaultMachineSettings() {
  return {
    steamSettings: {
      targetTemperature: 150,
      duration: 50,
      flow: 0.8,
      stopAtTemperature: 0
    },
    hotWaterData: {
      targetTemperature: 75,
      duration: 30,
      volume: 50,
      flow: 10
    },
    rinseData: {
      targetTemperature: 90,
      duration: 10,
      flow: 6
    }
  };
}

function buildWorkflow(bean, grinder, profile, shot) {
  return {
    id: `beanie-seed-workflow-${slug(bean.roaster)}-${slug(bean.name)}`,
    name: `${bean.roaster} ${bean.name}`,
    description: 'Seeded Beanie workflow',
    profile,
    context: {
      targetDoseWeight: shot.dose,
      targetYield: shot.targetYield,
      grinderId: grinder.id,
      grinderModel: grinder.model,
      grinderSetting: shot.grind,
      beanBatchId: bean.batchId,
      coffeeName: bean.name,
      coffeeRoaster: bean.roaster,
      finalBeverageType: 'espresso'
    },
    ...defaultMachineSettings()
  };
}

function buildMeasurements(timestamp, shot, profileTitle) {
  const frames = [];
  const duration = shot.duration;
  const count = Math.round(duration * 2);
  const start = new Date(timestamp).getTime();
  const maxPressure = profileTitle.includes('6 Bar') ? 6.2 : profileTitle.includes('Italian') ? 8.5 : 7.5;
  const targetTemp = profileTitle.includes('Bloom') || profileTitle.includes('light') ? 92.5 : 90.5;
  for (let i = 0; i <= count; i += 1) {
    const t = i / 2;
    const x = t / duration;
    const ramp = Math.min(1, x / 0.22);
    const decline = Math.max(0, (x - 0.58) / 0.42);
    const pressure = Math.max(0, maxPressure * ramp * (1 - decline * 0.38));
    const flowBase = 1.1 + 2.1 * Math.sin(Math.min(1, x) * Math.PI * 0.82);
    const flow = Math.max(0, x < 0.08 ? 0.4 + x * 10 : flowBase - decline * 1.2);
    const progress = Math.min(1, Math.pow(x, 1.25) * (1.1 - 0.1 * Math.sin(x * Math.PI)));
    const weight = doubleish(round(shot.actualYield * progress, 3));
    const time = new Date(start + t * 1000).toISOString();
    frames.push({
      machine: {
        timestamp: time,
        state: {
          state: i === count ? 'idle' : 'espresso',
          substate: i === count ? 'idle' : x < 0.18 ? 'preparingForShot' : 'pouring'
        },
        flow: i === count ? 0.001 : doubleish(round(flow, 3)),
        pressure: i === count ? 0.001 : doubleish(round(pressure, 3)),
        targetFlow: 0.001,
        targetPressure: doubleish(round(maxPressure, 1)),
        mixTemperature: doubleish(round(targetTemp - 0.5 + Math.sin(x * Math.PI) * 0.7, 2)),
        groupTemperature: doubleish(round(targetTemp - 0.8 + Math.sin(x * Math.PI) * 0.5, 2)),
        targetMixTemperature: doubleish(targetTemp),
        targetGroupTemperature: doubleish(targetTemp),
        profileFrame: Math.min(4, Math.floor(x * 5)),
        steamTemperature: 150
      },
      scale: {
        timestamp: time,
        weight,
        weightFlow: doubleish(round(flow * 0.78, 3)),
        battery: 100,
        timerValue: Math.round(t * 1000)
      },
      volume: doubleish(round(weight * 0.62, 3))
    });
  }
  return frames;
}

function buildShots(profileMap, fallback, grinderMap) {
  const rows = [];
  beans.forEach((bean, beanIndex) => {
    const grinder = grinderMap.get(bean.grinder) ?? grinderMap.values().next().value;
    const profile = pickProfile(profileMap, fallback, bean.profile);
    for (let shotIndex = 0; shotIndex < 6; shotIndex += 1) {
      const seed = shotSeed(bean, shotIndex);
      const dose = round(bean.baseDose + (shotIndex % 3 - 1) * 0.2, 1);
      const targetYield = round(bean.baseYield + (shotIndex % 4 - 1.5) * 1.2, 1);
      const actualYield = round(targetYield + (seed - 0.5) * 3, 1);
      const grind = round(bean.grind + shotIndex * 0.08 + (seed - 0.5) * 0.22, 2).toString();
      const timestamp = daysAgo(beanIndex * 2 + shotIndex + 1, beanIndex * 17 + shotIndex * 29);
      const duration = round(25 + (targetYield / dose - 2) * 5 + seed * 9 + shotIndex * 0.8, 1);
      const enjoyment = Math.round(74 + seed * 22 - Math.abs(shotIndex - 1.5) * 2);
      const tds = round(8.5 + seed * 2.8, 2);
      const ey = round((actualYield * tds) / dose, 2);
      const shot = {
        id: `beanie-seed-${slug(bean.roaster)}-${slug(bean.name)}-${shotIndex + 1}`,
        dose,
        targetYield,
        actualYield,
        grind,
        duration
      };
      const workflow = buildWorkflow(bean, grinder, profile, shot);
      const annotations = {
        actualDoseWeight: dose,
        actualYield,
        drinkTds: tds,
        drinkEy: ey,
        enjoyment,
        espressoNotes: notes[(beanIndex + shotIndex) % notes.length],
        extras: {
          source: 'beanie-seed',
          brewRatio: round(actualYield / dose, 2)
        }
      };
      rows.push({
        id: shot.id,
        timestamp,
        profileTitle: profile.title ?? bean.profile,
        grinderId: grinder.id,
        grinderModel: grinder.model,
        grinderSetting: grind,
        beanBatchId: bean.batchId,
        coffeeName: bean.name,
        coffeeRoaster: bean.roaster,
        targetDoseWeight: dose,
        targetYield,
        enjoyment,
        espressoNotes: annotations.espressoNotes,
        workflow,
        annotations,
        measurements: buildMeasurements(timestamp, shot, profile.title ?? bean.profile)
      });
    }
  });
  return rows;
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertShots(rows) {
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const columns = [
    'id',
    'timestamp',
    'profile_title',
    'grinder_id',
    'grinder_model',
    'grinder_setting',
    'bean_batch_id',
    'coffee_name',
    'coffee_roaster',
    'target_dose_weight',
    'target_yield',
    'enjoyment',
    'espresso_notes',
    'workflow_json',
    'annotations_json',
    'measurements_json'
  ];

  const statements = [
    'PRAGMA busy_timeout = 5000;',
    'BEGIN IMMEDIATE;',
    ...rows.map((row) => {
      const values = [
        row.id,
        row.timestamp,
        row.profileTitle,
        row.grinderId,
        row.grinderModel,
        row.grinderSetting,
        row.beanBatchId,
        row.coffeeName,
        row.coffeeRoaster,
        row.targetDoseWeight,
        row.targetYield,
        row.enjoyment,
        row.espressoNotes,
        JSON.stringify(row.workflow),
        JSON.stringify(row.annotations),
        JSON.stringify(row.measurements)
      ];
      return `INSERT OR REPLACE INTO shot_records (${columns.join(', ')}) VALUES (${values.map(sqlValue).join(', ')});`;
    }),
    'COMMIT;'
  ].join('\n');

  const result = spawnSync('sqlite3', [dbPath], {
    input: statements,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`sqlite3 failed:\n${result.stderr || result.stdout}`);
  }
}

async function updateCurrentWorkflow(rows) {
  const latest = rows[0];
  await json('/api/v1/workflow', {
    method: 'PUT',
    body: JSON.stringify({
      name: latest.workflow.name,
      profile: latest.workflow.profile,
      context: latest.workflow.context
    })
  });
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function doubleish(value) {
  return Number.isInteger(value) ? value + 0.001 : value;
}

async function main() {
  await json('/api/v1/devices');
  const grinderMap = await ensureGrinders();
  await ensureBeansAndBatches();
  const { byTitle, fallback } = await loadProfiles();
  const rows = buildShots(byTitle, fallback, grinderMap);
  insertShots(rows);
  await updateCurrentWorkflow(rows);

  const totals = await json('/api/v1/shots?limit=1&offset=0&order=desc');
  console.log(
    JSON.stringify(
      {
        gateway,
        dbPath,
        beansSeeded: beans.length,
        grindersSeeded: grinders.length,
        shotsSeeded: rows.length,
        totalShots: totals.total,
        currentWorkflow: rows[0].workflow.name
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
