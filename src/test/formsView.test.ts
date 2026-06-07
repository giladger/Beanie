import type { Bean, Grinder } from '../api/types';
import {
  renderBatchEditorPage,
  renderBeanEditorPage,
  renderGrinderEditorPage,
  renderMachineLabelModal
} from '../views/formsView';

const bean: Bean = {
  id: 'bean-1',
  roaster: 'Dak <Roasters>',
  name: 'Milky & Cake',
  country: 'Ethiopia',
  region: 'Sidama',
  processing: 'Anaerobic',
  notes: 'Sweet <soft>'
};

const grinder: Grinder = {
  id: 'grinder-1',
  model: 'EK43 <S>',
  burrs: 'Cast',
  settingType: 'preset',
  settingSmallStep: 0.25,
  settingBigStep: 2
};

run('bean editor renders escaped values and supplied header', () => {
  const html = renderBeanEditorPage('<header>Bean header</header>', bean);

  includes(html, '<header>Bean header</header>');
  includes(html, 'value="Dak &lt;Roasters&gt;"');
  includes(html, 'value="Milky &amp; Cake"');
  includes(html, 'Sweet &lt;soft&gt;');
  excludes(html, 'Dak <Roasters>');
});

run('batch editor renders selected bean label and form number controls', () => {
  const html = renderBatchEditorPage('<header>Batch header</header>', bean, {
    'batch-form:weight': '250',
    'batch-form:weightRemaining': '140'
  });

  includes(html, '<header>Batch header</header>');
  includes(html, 'Dak &lt;Roasters&gt; Milky &amp; Cake');
  includes(html, 'data-form-key="batch-form:weight"');
  includes(html, 'data-value="250"');
  includes(html, 'data-unit="g"');
});

run('batch editor handles missing bean without owner state', () => {
  const html = renderBatchEditorPage('<header>Batch header</header>', null, {});

  includes(html, 'No bean selected');
  includes(html, 'data-form="batch-editor"');
});

run('grinder editor renders escaped grinder data, preset selection, and form overrides', () => {
  const html = renderGrinderEditorPage('<header>Grinder header</header>', grinder, {
    'grinder-form:grinder-1:settingSmallStep': '0.5'
  });

  includes(html, '<header>Grinder header</header>');
  includes(html, 'value="EK43 &lt;S&gt;"');
  includes(html, '<option value="preset" selected>Preset</option>');
  includes(html, 'data-form-key="grinder-form:grinder-1:settingSmallStep"');
  includes(html, 'data-value="0.5"');
  includes(html, 'data-form-key="grinder-form:grinder-1:settingBigStep"');
  includes(html, 'data-value="2"');
});

run('machine label modal escapes the editable label', () => {
  const html = renderMachineLabelModal('Steam <fast>');

  includes(html, 'machine-label-modal');
  includes(html, 'value="Steam &lt;fast&gt;"');
  excludes(html, 'value="Steam <fast>"');
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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 280))} to include ${expected}`);
  }
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) {
    throw new Error(`Expected rendered output not to include ${expected}`);
  }
}
