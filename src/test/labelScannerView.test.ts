import {
  renderLabelScannerModal,
  type LabelScannerViewModel
} from '../views/labelScannerView';

run('onboard step explains the free key and links to AI Studio', () => {
  const html = renderLabelScannerModal(model({ step: 'onboard', keyDraft: 'AIzaABC' }));
  includes(html, '<h2>AI Label Scanner</h2>');
  includes(html, 'https://aistudio.google.com/apikey');
  includes(html, 'data-form="scanner-onboard"');
  includes(html, 'name="apiKey"');
  includes(html, 'value="AIzaABC"');
});

run('onboard surfaces a verify message when present', () => {
  const html = renderLabelScannerModal(
    model({ step: 'onboard', verifyMessage: { tone: 'warn', text: 'Key rejected (400).' } })
  );
  includes(html, 'is-warn');
  includes(html, 'Key rejected (400).');
});

run('onboard shows a QR hand-off on the tablet, hiding the on-device key form', () => {
  const html = renderLabelScannerModal(
    model({
      step: 'onboard',
      handoff: true,
      qrSvg: '<svg id="qr"></svg>',
      qrUrl: 'http://192.168.1.42:3000/?beanieScan=1'
    })
  );
  notIncludes(html, 'class="eyebrow"');
  includes(html, '<svg id="qr">');
  includes(html, 'http://192.168.1.42:3000/?beanieScan=1');
  includes(html, 'data-action="scanner-setup-here"');
  notIncludes(html, 'name="apiKey"');
});

run('onboard hand-off points the user to their phone when there is no QR', () => {
  const html = renderLabelScannerModal(model({ step: 'onboard', handoff: true, qrSvg: null }));
  includes(html, 'on your phone');
  includes(html, 'quick settings');
  includes(html, 'data-action="scanner-setup-here"');
  notIncludes(html, 'name="apiKey"');
});

run('onboard direct mode offers a phone hand-off toggle when a QR is available', () => {
  const html = renderLabelScannerModal(model({ step: 'onboard', handoff: false, qrSvg: '<svg></svg>' }));
  includes(html, 'name="apiKey"');
  includes(html, 'data-action="scanner-use-phone"');
});

run('capture step offers a camera file input and disables extract until a photo exists', () => {
  const html = renderLabelScannerModal(model({ step: 'capture' }));
  includes(html, 'data-action="scanner-add-photos"');
  includes(html, 'capture="environment"');
  includes(html, 'data-action="scanner-extract" disabled');
  notIncludes(html, 'Change key');
  notIncludes(html, 'data-action="scanner-change-key"');
});

run('capture enables extract in demo mode and hides the key control', () => {
  const html = renderLabelScannerModal(model({ step: 'capture', demo: true }));
  includes(html, 'Demo mode');
  notIncludes(html, 'data-action="scanner-extract" disabled');
  notIncludes(html, 'Change key');
});

run('capture renders thumbnails with remove buttons', () => {
  const html = renderLabelScannerModal(
    model({ step: 'capture', images: [{ dataUrl: 'data:image/jpeg;base64,AAA' }] })
  );
  includes(html, 'data:image/jpeg;base64,AAA');
  includes(html, 'data-action="scanner-remove-photo" data-index="0"');
});

run('review pre-fills fields and flags low-confidence ones', () => {
  const html = renderLabelScannerModal(
    model({
      step: 'review',
      draft: draft({ roaster: 'Onyx', name: 'Geometry', weight: '250' }),
      lowConfidence: ['roastDate']
    })
  );
  includes(html, 'data-form="scanner-review"');
  includes(html, 'value="Onyx"');
  includes(html, 'name="weight"');
  includes(html, 'is-uncertain'); // the flagged roastDate field
  includes(html, 'New bean from this bag');
  includes(html, 'Add bean');
});

run('review routes to a new batch when the bean already exists', () => {
  const html = renderLabelScannerModal(
    model({ step: 'review', draft: draft({ roaster: 'Onyx', name: 'Geometry' }), existingBeanLabel: 'Onyx Geometry' })
  );
  includes(html, 'Adding a bag to your <strong>Onyx Geometry</strong>');
  includes(html, 'Add bag');
});

run('review offers an enrich button and flags web-sourced fields distinctly', () => {
  const html = renderLabelScannerModal(
    model({
      step: 'review',
      draft: draft({ roaster: 'Onyx', name: 'Geometry', country: 'Colombia' }),
      webFields: ['country']
    })
  );
  includes(html, 'data-action="scanner-enrich"');
  includes(html, 'Enrich from roaster');
  includes(html, 'is-web');
  includes(html, 'scan-web-tag');
});

run('review shows a searching state while enriching', () => {
  const html = renderLabelScannerModal(model({ step: 'review', draft: draft({}), enriching: true }));
  includes(html, 'Searching the roaster');
  includes(html, 'data-action="scanner-enrich" disabled');
});

run('error step shows the message and a retry', () => {
  const html = renderLabelScannerModal(model({ step: 'error', error: 'Could not reach Gemini' }));
  includes(html, 'Could not reach Gemini');
  includes(html, 'Try again');
});

function model(overrides: Partial<LabelScannerViewModel>): LabelScannerViewModel {
  return {
    step: 'onboard',
    demo: false,
    handoff: false,
    qrSvg: null,
    qrUrl: null,
    keyDraft: '',
    verifying: false,
    verifyMessage: null,
    images: [],
    draft: null,
    lowConfidence: [],
    webFields: [],
    enriching: false,
    existingBeanLabel: null,
    saving: false,
    error: null,
    ...overrides
  };
}

function draft(overrides: Partial<LabelScannerViewModel['draft'] & object>): NonNullable<LabelScannerViewModel['draft']> {
  return {
    roaster: '',
    name: '',
    country: '',
    region: '',
    processing: '',
    notes: '',
    roastDate: '',
    roastLevel: '',
    weight: '',
    ...overrides
  };
}

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
  }
}

function notIncludes(text: string, unexpected: string): void {
  if (text.includes(unexpected)) {
    throw new Error(`Expected output NOT to include ${JSON.stringify(unexpected)}`);
  }
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
