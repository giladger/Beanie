import type { Bean, Grinder } from '../api/types';
import type { ShotEditDraft } from '../domain/shotEditModel';
import { renderShotEditModal, type ShotEditModalViewModel } from '../views/shotEditorView';

const grinders: Grinder[] = [
  { id: 'grinder-1', model: 'Niche Zero', burrs: 'Mazzer' }
];

const beans: Bean[] = [
  { id: 'bean-1', roaster: 'Dak', name: 'Milky Cake', country: 'Ethiopia' },
  { id: 'bean-2', roaster: 'April', name: 'Pink Bourbon' }
];

run('shot editor renders the main modal from a plain view model', () => {
  const html = renderShotEditModal(model());

  includes(html, 'Edit shot');
  includes(html, 'Dak · Milky Cake');
  includes(html, 'Batch Jun');
  includes(html, 'Niche Zero');
  includes(html, 'shot-score-word good active');
  includes(html, 'data-form="shot-dye-editor"');
});

run('shot editor renders nested field options when a field dialog is active', () => {
  const html = renderShotEditModal(
    model({
      fieldDialog: {
        field: 'espressoNotes',
        spec: {
          label: 'Notes',
          kind: 'textarea',
          value: 'Sweet <clean>',
          options: [{ label: 'Clear', value: '' }]
        }
      }
    })
  );

  includes(html, 'data-form="shot-field-dialog"');
  includes(html, 'Sweet &lt;clean&gt;');
  includes(html, 'Notes options');
});

run('shot editor renders bean picker and new-bean states', () => {
  const picker = renderShotEditModal(
    model({
      beanDialog: {
        state: { creating: false },
        selectedBeanId: 'bean-2',
        beans,
        prefillBeans: beans
      }
    })
  );
  includes(picker, 'data-action="shot-bean-pick" data-id="bean-2"');
  includes(picker, 'Pink Bourbon');

  const create = renderShotEditModal(
    model({
      beanDialog: {
        state: { creating: true },
        selectedBeanId: null,
        beans,
        prefillBeans: beans
      }
    })
  );
  includes(create, 'data-form="shot-bean-create"');
  includes(create, 'Copy from');
  includes(create, 'Add bean');
});

function model(overrides: Partial<ShotEditModalViewModel> = {}): ShotEditModalViewModel {
  return {
    shotId: 'shot-1',
    shotLabel: 'Jun 5, 10:00 AM',
    draft: draft(),
    grinders,
    beanSummary: {
      batchLabel: 'Batch Jun'
    },
    fieldDialog: null,
    beanDialog: null,
    ...overrides
  };
}

function draft(): ShotEditDraft {
  return {
    shotId: 'shot-1',
    coffeeRoaster: 'Dak',
    coffeeName: 'Milky Cake',
    beanBatchId: 'batch-1',
    finalBeverageType: 'espresso',
    baristaName: 'Ada',
    drinkerName: 'Gilad',
    targetDoseWeight: 18,
    targetYield: 36,
    actualDoseWeight: 18.1,
    actualYield: 37.2,
    grinderId: 'grinder-1',
    grinderModel: 'Niche Zero',
    grinderSetting: '12',
    drinkTds: 9.25,
    drinkEy: 20.5,
    enjoyment: 80,
    espressoNotes: 'Sweet and round',
    contextExtras: null,
    annotationExtras: null
  };
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 240))} to include ${expected}`);
  }
}
