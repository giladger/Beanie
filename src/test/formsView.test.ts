import type { Grinder } from '../api/types';
import {
  renderGrinderEditorPage,
  renderMachineLabelModal
} from '../views/formsView';

const grinder: Grinder = {
  id: 'grinder-1',
  model: 'EK43 <S>',
  burrs: 'Cast',
  settingType: 'preset',
  settingSmallStep: 0.25,
  settingBigStep: 2
};

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
