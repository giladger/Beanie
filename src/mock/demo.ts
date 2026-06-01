import type {
  Bean,
  BeanBatch,
  Grinder,
  MachineSnapshot,
  ProfileRecord,
  ShotRecord,
  Workflow
} from '../api/types';

const now = Date.now();

export const demoBeans: Bean[] = [
  {
    id: 'bean-tore-badiya',
    roaster: 'Tsukcafe',
    name: 'Tore Badiya Anaerobic',
    country: 'Ethiopia',
    region: 'Sidama',
    processing: 'anaerobic natural',
    notes: 'orange, cocoa, light florals'
  },
  {
    id: 'bean-pink-bourbon',
    roaster: 'Kawa',
    name: 'Pink Bourbon',
    country: 'Colombia',
    processing: 'washed',
    notes: 'red berries, panela, clean finish'
  },
  {
    id: 'bean-kenya',
    roaster: 'Nomad',
    name: 'Kenya Kamwangi',
    country: 'Kenya',
    processing: 'washed',
    notes: 'blackcurrant, grapefruit'
  },
  {
    id: 'bean-sweetshop',
    roaster: 'Square Mile',
    name: 'Sweetshop',
    country: 'Rwanda',
    processing: 'washed',
    notes: 'sweet citrus and tea'
  },
  {
    id: 'bean-april',
    roaster: 'April',
    name: 'Ethiopia Nano Genji',
    country: 'Ethiopia',
    processing: 'washed',
    notes: 'jasmine, peach, honey'
  }
];

export const demoBatches: Record<string, BeanBatch[]> = {
  'bean-tore-badiya': [
    {
      id: 'batch-tore-1',
      beanId: 'bean-tore-badiya',
      roastDate: '2026-05-22T00:00:00Z',
      roastLevel: 'medium-light',
      weight: 250,
      weightRemaining: 118
    }
  ],
  'bean-pink-bourbon': [
    {
      id: 'batch-pink-1',
      beanId: 'bean-pink-bourbon',
      roastDate: '2026-05-19T00:00:00Z',
      roastLevel: 'light',
      weight: 200,
      weightRemaining: 74
    }
  ],
  'bean-kenya': [
    {
      id: 'batch-kenya-1',
      beanId: 'bean-kenya',
      roastDate: '2026-05-14T00:00:00Z',
      roastLevel: 'light',
      weight: 250,
      weightRemaining: 92
    }
  ]
};

export const demoGrinders: Grinder[] = [
  {
    id: 'grinder-df64',
    model: 'DF64 Gen 2',
    burrs: 'SSP MP',
    settingType: 'numeric',
    settingSmallStep: 0.1,
    settingBigStep: 0.5
  },
  {
    id: 'grinder-niche',
    model: 'Niche Zero',
    burrs: 'Mazzer Kony',
    settingType: 'numeric',
    settingSmallStep: 0.5,
    settingBigStep: 2
  }
];

export const demoProfiles: ProfileRecord[] = [
  {
    id: 'profile-default',
    profile: {
      title: 'Default',
      author: 'Decent',
      beverage_type: 'espresso',
      target_weight: 40,
      steps: [{ name: 'Preinfusion' }, { name: 'Rise' }, { name: 'Hold' }]
    }
  },
  {
    id: 'profile-blooming',
    profile: {
      title: 'Blooming Espresso',
      author: 'Decent',
      beverage_type: 'espresso',
      target_weight: 42,
      steps: [{ name: 'Bloom' }, { name: 'Pressure' }]
    }
  },
  {
    id: 'profile-lrv3',
    profile: {
      title: 'LRv3',
      author: 'Damian',
      beverage_type: 'espresso',
      target_weight: 45,
      steps: [{ name: 'Ramp' }, { name: 'Lever' }, { name: 'Decline' }]
    }
  }
];

export const demoWorkflow: Workflow = {
  name: 'Tsukcafe Tore Badiya Anaerobic',
  profile: demoProfiles[0]!.profile,
  context: {
    targetDoseWeight: 18,
    targetYield: 40,
    grinderId: 'grinder-df64',
    grinderModel: 'DF64 Gen 2',
    grinderSetting: '5.5',
    beanBatchId: 'batch-tore-1',
    coffeeRoaster: 'Tsukcafe',
    coffeeName: 'Tore Badiya Anaerobic'
  }
};

export const demoMachine: MachineSnapshot = {
  timestamp: new Date().toISOString(),
  state: { state: 'idle', substate: 'preparingForShot' },
  flow: 0,
  pressure: 0,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 93.4,
  groupTemperature: 93.2,
  targetMixTemperature: 93,
  targetGroupTemperature: 93,
  profileFrame: 0,
  steamTemperature: 132
};

export function demoShotsForBean(bean: Bean): ShotRecord[] {
  const base =
    bean.id === 'bean-pink-bourbon'
      ? { dose: 18, yield: 42, grind: '6.1', profile: demoProfiles[1]!.profile }
      : bean.id === 'bean-kenya'
        ? { dose: 18, yield: 82, grind: '5.8', profile: demoProfiles[1]!.profile }
        : bean.id === 'bean-sweetshop'
          ? { dose: 19, yield: 45, grind: '6.0', profile: demoProfiles[2]!.profile }
          : { dose: 18, yield: 40, grind: '5.5', profile: demoProfiles[0]!.profile };

  return Array.from({ length: 8 }, (_, index) => {
    const timestamp = new Date(now - index * 86_400_000 - index * 1_800_000).toISOString();
    const dose = base.dose + (index % 3 === 0 ? 0 : index % 2 === 0 ? 0.2 : -0.2);
    const yieldWeight = base.yield + (index % 2 === 0 ? index * 0.4 : -index * 0.3);
    return {
      id: `${bean.id}-shot-${index}`,
      timestamp,
      workflow: {
        name: `${bean.roaster} ${bean.name}`,
        profile: base.profile,
        context: {
          targetDoseWeight: Number(dose.toFixed(1)),
          targetYield: Number(yieldWeight.toFixed(1)),
          grinderId: 'grinder-df64',
          grinderModel: 'DF64 Gen 2',
          grinderSetting: (Number(base.grind) + index * 0.04).toFixed(1),
          beanBatchId: demoBatches[bean.id]?.[0]?.id ?? null,
          coffeeRoaster: bean.roaster,
          coffeeName: bean.name,
          finalBeverageType: 'espresso'
        }
      },
      annotations: {
        actualDoseWeight: Number(dose.toFixed(1)),
        actualYield: Number((yieldWeight + (index % 2 ? -0.6 : 0.4)).toFixed(1)),
        enjoyment: Math.max(62, 92 - index * 4),
        espressoNotes: index === 0 ? 'clean, sweet finish' : index === 1 ? 'a little sharp' : 'reference shot'
      },
      measurements: buildMeasurements(index)
    };
  });
}

function buildMeasurements(seed: number) {
  const start = now - seed * 86_400_000;
  return Array.from({ length: 48 }, (_, i) => {
    const t = i / 47;
    const pressure = Math.max(0, Math.sin(t * Math.PI) * 9 - seed * 0.08);
    const flow = Math.max(0, 1.1 + Math.sin(t * Math.PI * 1.5) * 1.8 - t * 0.6);
    const weight = Math.max(0, t * (38 + seed * 0.7));
    return {
      machine: {
        timestamp: new Date(start + i * 650).toISOString(),
        pressure,
        flow,
        mixTemperature: 92 + Math.sin(t * Math.PI) * 1.1,
        groupTemperature: 93
      },
      scale: {
        timestamp: new Date(start + i * 650).toISOString(),
        weight,
        weightFlow: flow * 0.85
      },
      volume: t * 40
    };
  });
}

