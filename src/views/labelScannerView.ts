import { escapeAttr, escapeHtml } from '../components/html';
import { icon } from '../components/icons';
import type { LabelScanDraft, LabelScanDraftField } from '../domain/labelScan';

/**
 * AI label scanner modal (Phase 1) — a pure view over the scanner's state.
 *
 * Four working steps plus an error state. Inputs are uncontrolled and read from
 * the form on submit (same idiom as the bean form), so typing never triggers a
 * re-render. The review step pre-fills the same bean/batch fields Beanie already
 * uses; low-confidence fields are flagged for the human to double-check — the
 * scan only fills a draft, it never saves on its own. A roaster-website lookup
 * (enrich) starts automatically when the review opens; the button re-runs it.
 */

export type LabelScannerStep = 'onboard' | 'capture' | 'extracting' | 'review' | 'error';

export interface LabelScannerViewModel {
  step: LabelScannerStep;
  /** Demo mode: no key needed, extraction returns a sample. */
  demo: boolean;
  /** Tablet hand-off: show the QR to continue on a phone instead of the key form. */
  handoff: boolean;
  qrSvg: string | null;
  qrUrl: string | null;
  keyDraft: string;
  verifying: boolean;
  verifyMessage: { tone: 'good' | 'warn'; text: string } | null;
  images: Array<{ dataUrl: string }>;
  draft: LabelScanDraft | null;
  lowConfidence: LabelScanDraftField[];
  /** Fields filled from the roaster's website (enrich) — flagged distinctly. */
  webFields: LabelScanDraftField[];
  enriching: boolean;
  /** Set when the scan matches a bean you already have — routes to a new batch. */
  existingBeanLabel: string | null;
  /** Beans already in the library from the scanned roaster — a familiar-roaster nod. */
  roasterBeanCount: number;
  saving: boolean;
  error: string | null;
}

export function renderLabelScannerModal(model: LabelScannerViewModel): string {
  return `
    <div class="modal-backdrop label-scanner-backdrop" data-action="close-modal">
      <section class="modal panel label-scanner-modal" role="dialog" aria-modal="true" aria-label="Scan a bag" data-action="noop">
        <div class="modal-head">
          <div>
            <h2>AI Label Scanner</h2>
          </div>
          <div class="modal-head-actions">
            <button class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
        </div>
        <div class="label-scanner-body">
          ${renderStep(model)}
        </div>
      </section>
    </div>
  `;
}

function renderStep(model: LabelScannerViewModel): string {
  switch (model.step) {
    case 'onboard':
      return renderOnboard(model);
    case 'capture':
      return renderCapture(model);
    case 'extracting':
      return renderExtracting();
    case 'review':
      return renderReview(model);
    case 'error':
      return renderError(model);
  }
}

function renderOnboard(model: LabelScannerViewModel): string {
  if (model.handoff) {
    const body = model.qrSvg
      ? `<p>Signing in to Google and pasting a key is easier on your phone — point your phone's camera at this to set up and scan there:</p>
         <div class="scan-qr">${model.qrSvg}</div>
         ${model.qrUrl ? `<p class="scan-qr-url">${escapeHtml(model.qrUrl)}</p>` : ''}`
      : `<p>Scanning is easiest on your phone. Open Beanie on your phone — Decent's <strong>quick settings</strong> screen shows this tablet's QR — then tap the bean scanner.</p>`;
    return `
      <div class="label-scanner-onboard">
        ${body}
        <div class="label-scanner-actions">
          <button type="button" class="secondary-button" data-action="scanner-setup-here">Set up on this device</button>
        </div>
      </div>
    `;
  }
  return `
    <form class="label-scanner-onboard" data-form="scanner-onboard">
      ${
        model.qrSvg
          ? `<button type="button" class="scan-phone-toggle" data-action="scanner-use-phone">${icon('camera')}<span>Set up on my phone instead</span></button>`
          : ''
      }
      <p>Beanie reads your bag with Google's <strong>Gemini</strong> — free, no credit card. One-time setup:</p>
      <ol class="label-scanner-steps">
        <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> and sign in.</li>
        <li>Click <strong>Create API key</strong>, then copy it.</li>
        <li>Paste it below.</li>
      </ol>
      <label class="label-scanner-key">API key
        <input type="password" name="apiKey" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${escapeAttr(model.keyDraft)}" />
      </label>
      ${renderMessage(model.verifyMessage)}
      <p class="label-scanner-fineprint">Your key stays on this device. Free-tier scans may be used by Google to improve its models, so don't scan anything sensitive.</p>
      <div class="label-scanner-actions">
        <button type="button" class="secondary-button" data-action="scanner-verify-key" ${model.verifying ? 'disabled' : ''}>${model.verifying ? 'Checking…' : 'Test key'}</button>
        <button type="submit" class="primary-button">${icon('check')}<span>Save &amp; continue</span></button>
      </div>
    </form>
  `;
}

// The file input has no `capture` attribute on purpose: capture forces
// camera-only on phones, blocking photos the user already took of the bag.
function renderCapture(model: LabelScannerViewModel): string {
  const canExtract = model.demo || model.images.length > 0;
  return `
    <div class="label-scanner-capture">
      ${model.demo ? '<p class="scan-demo-note">Demo mode — extraction returns a sample bag.</p>' : ''}
      <p>Add a clear photo of the front, plus the back if it shows the roast date or weight.</p>
      <label class="scan-add-photos">
        ${icon('camera')}<span>Add photos</span>
        <input type="file" accept="image/*" multiple data-action="scanner-add-photos" />
      </label>
      ${
        model.images.length === 0
          ? ''
          : `<div class="scan-thumbs">${model.images
              .map(
                (image, index) => `
                <div class="scan-thumb">
                  <img src="${escapeAttr(image.dataUrl)}" alt="Bag photo ${index + 1}" />
                  <button type="button" class="icon-button" data-action="scanner-remove-photo" data-index="${index}" aria-label="Remove photo">${icon('x')}</button>
                </div>`
              )
              .join('')}</div>`
      }
      <div class="label-scanner-actions">
        <button type="button" class="primary-button" data-action="scanner-extract" ${canExtract ? '' : 'disabled'}>${icon('sparkles')}<span>Extract</span></button>
      </div>
    </div>
  `;
}

function renderExtracting(): string {
  return `
    <div class="label-scanner-extracting">
      <div class="scan-spinner" aria-hidden="true"></div>
      <p>Reading your bag…</p>
      <div class="label-scanner-actions">
        <button type="button" class="secondary-button" data-action="scanner-rescan">Cancel</button>
      </div>
    </div>
  `;
}

function renderReview(model: LabelScannerViewModel): string {
  const draft = model.draft;
  if (!draft) return renderError({ ...model, error: 'Nothing to review.' });
  const uncertain = new Set(model.lowConfidence);
  const web = new Set(model.webFields);
  const flag = (field: LabelScanDraftField): FieldFlag => fieldFlag(field, uncertain, web);
  const saveLabel = model.saving ? 'Saving…' : model.existingBeanLabel ? 'Add bag' : 'Add bean';
  return `
    <form class="label-scanner-review" data-form="scanner-review">
      <p class="scan-review-head">${renderReviewHead(model, draft)}</p>
      <div class="scan-review-grid">
        <div class="scan-review-fields">
          ${textField('roaster', 'Roaster', draft.roaster, flag('roaster'), 'required')}
          ${textField('name', 'Bean', draft.name, flag('name'), 'required')}
          ${textField('country', 'Country', draft.country, flag('country'))}
          ${textField('region', 'Region', draft.region, flag('region'))}
          ${textField('processing', 'Process', draft.processing, flag('processing'))}
          ${dateField('roastDate', 'Roast date', draft.roastDate, flag('roastDate'))}
          ${textField('roastLevel', 'Roast level', draft.roastLevel, flag('roastLevel'))}
          ${numberField('weight', 'Bag (g)', draft.weight, flag('weight'))}
          ${notesField('notes', 'Notes', draft.notes, flag('notes'))}
        </div>
        ${
          model.images.length === 0
            ? ''
            : `<div class="scan-review-thumbs">${model.images
                .map((image, index) => `<img src="${escapeAttr(image.dataUrl)}" alt="Bag photo ${index + 1}" />`)
                .join('')}</div>`
        }
      </div>
      <div class="scan-enrich-row">
        <button type="button" class="secondary-button" data-action="scanner-enrich" ${model.enriching ? 'disabled' : ''}>${icon('sparkles')}<span>${model.enriching ? 'Searching the roaster…' : 'Enrich from roaster'}</span></button>
      </div>
      <div class="label-scanner-actions">
        <button type="button" class="secondary-button" data-action="scanner-rescan">${icon('rotate-ccw')}<span>Rescan</span></button>
        <button type="submit" class="primary-button" ${model.saving ? 'disabled' : ''}>${icon('check')}<span>${escapeHtml(saveLabel)}</span></button>
      </div>
    </form>
  `;
}

function renderReviewHead(model: LabelScannerViewModel, draft: LabelScanDraft): string {
  if (model.existingBeanLabel) return `Adding a bag to your <strong>${escapeHtml(model.existingBeanLabel)}</strong>`;
  const roaster = draft.roaster.trim();
  if (model.roasterBeanCount > 0 && roaster) {
    return `New bean — your ${ordinal(model.roasterBeanCount + 1)} from <strong>${escapeHtml(roaster)}</strong>. Check the details, then save.`;
  }
  return 'New bean from this bag — check the details, then save.';
}

function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

function renderError(model: LabelScannerViewModel): string {
  return `
    <div class="label-scanner-error">
      <p class="scan-message is-warn">${escapeHtml(model.error ?? 'Something went wrong.')}</p>
      <div class="label-scanner-actions">
        <button type="button" class="secondary-button" data-action="close-modal">Close</button>
        <button type="button" class="primary-button" data-action="scanner-rescan">${icon('rotate-ccw')}<span>Try again</span></button>
      </div>
    </div>
  `;
}

function renderMessage(message: LabelScannerViewModel['verifyMessage']): string {
  if (!message) return '';
  return `<p class="scan-message is-${message.tone}">${escapeHtml(message.text)}</p>`;
}

type FieldFlag = 'web' | 'uncertain' | null;

function fieldFlag(
  field: LabelScanDraftField,
  uncertain: Set<LabelScanDraftField>,
  web: Set<LabelScanDraftField>
): FieldFlag {
  if (web.has(field)) return 'web';
  if (uncertain.has(field)) return 'uncertain';
  return null;
}

function fieldClass(flag: FieldFlag): string {
  return `scan-field${flag === 'web' ? ' is-web' : flag === 'uncertain' ? ' is-uncertain' : ''}`;
}

function fieldLabelSpan(label: string, flag: FieldFlag): string {
  const tag =
    flag === 'web'
      ? ' <small class="scan-web-tag">web</small>'
      : flag === 'uncertain'
        ? ' <small class="scan-uncertain-tag">check</small>'
        : '';
  return `<span>${escapeHtml(label)}${tag}</span>`;
}

function textField(field: LabelScanDraftField, label: string, value: string, flag: FieldFlag, attrs = ''): string {
  return `
    <label class="${fieldClass(flag)}">
      ${fieldLabelSpan(label, flag)}
      <input name="${field}" autocomplete="off" value="${escapeAttr(value)}" ${attrs} />
    </label>
  `;
}

function dateField(field: LabelScanDraftField, label: string, value: string, flag: FieldFlag): string {
  return `
    <label class="${fieldClass(flag)}">
      ${fieldLabelSpan(label, flag)}
      <input type="date" name="${field}" value="${escapeAttr(value)}" />
    </label>
  `;
}

function numberField(field: LabelScanDraftField, label: string, value: string, flag: FieldFlag): string {
  return `
    <label class="${fieldClass(flag)}">
      ${fieldLabelSpan(label, flag)}
      <input type="number" inputmode="decimal" min="0" step="1" name="${field}" value="${escapeAttr(value)}" />
    </label>
  `;
}

function notesField(field: LabelScanDraftField, label: string, value: string, flag: FieldFlag): string {
  return `
    <label class="${fieldClass(flag)} scan-field-notes">
      ${fieldLabelSpan(label, flag)}
      <textarea name="${field}" rows="3" autocomplete="off">${escapeHtml(value)}</textarea>
    </label>
  `;
}
