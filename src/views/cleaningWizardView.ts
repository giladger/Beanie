import { escapeHtml } from '../components/html';
import { icon } from '../components/icons';
import {
  CLEANING_WIZARD_STEP_COUNT,
  cleaningWizardStepIndex,
  cleaningWizardStepKind,
  type CleaningWizardStep
} from '../controllers/cleaningWizardController';

interface StepCopy {
  eyebrow: string;
  title: string;
  body: string;
  /** Action button label for pull/flush steps. */
  actionLabel?: string;
}

const STEP_COPY: Record<CleaningWizardStep, StepCopy> = {
  solution: {
    eyebrow: 'Prepare',
    title: 'Load the blind basket',
    body: 'Add a level scoop of backflush detergent (Cafiza or similar) to a blind basket — the one with no holes — and lock the portafilter into the group.'
  },
  'pull-1': {
    eyebrow: 'Backflush',
    title: 'Run the cleaning profile',
    body: 'This runs the forward-flush profile. With no way out through the basket, the water pushes detergent up through the group and back out the drain, scrubbing the three-way valve.',
    actionLabel: 'Run cleaning profile'
  },
  remove: {
    eyebrow: 'Reset',
    title: 'Remove the portafilter',
    body: 'Unlock and take out the portafilter. It will be hot and may hold detergent water — tip it into the drip tray.'
  },
  flush: {
    eyebrow: 'Rinse',
    title: 'Flush the group',
    body: 'Run clean water through the open group head to rinse away the loosened detergent and coffee oils.',
    actionLabel: 'Run flush'
  },
  'rinse-refit': {
    eyebrow: 'Reset',
    title: 'Rinse the basket & refit',
    body: 'Empty and rinse the blind basket so no detergent is left behind, then lock the blind portafilter back into the group for one last cycle.'
  },
  'pull-2': {
    eyebrow: 'Final backflush',
    title: 'Run the cleaning profile again',
    body: 'A second forward-flush clears any remaining detergent. After this the group is rinsed and ready to brew.',
    actionLabel: 'Run cleaning profile'
  },
  done: {
    eyebrow: 'Done',
    title: 'Cleaning complete',
    body: 'The group is clean and your recipe has been restored. Pull a shot to dial back in.'
  }
};

export interface CleaningWizardViewModel {
  step: CleaningWizardStep;
  note: string | null;
  /** An action started from this step is running on the machine. */
  actionPending: 'pull' | 'flush' | null;
  /** Whether a cleaning profile is installed, so the pull steps can run. */
  canRunPull: boolean;
  /** The machine has a group-head controller — the app loads the profile but
   *  the DE1 firmware only starts flows from the physical GHC, not the API. */
  hasGhc: boolean;
  /** A profile load / command is in flight (don't tell the user it's ready yet). */
  loading: boolean;
}

export function renderCleaningWizardModal(model: CleaningWizardViewModel): string {
  const copy = STEP_COPY[model.step];
  const kind = cleaningWizardStepKind(model.step);
  const index = cleaningWizardStepIndex(model.step);
  const stepNumber = Math.min(index + 1, CLEANING_WIZARD_STEP_COUNT);

  const eyebrow = kind === 'done'
    ? copy.eyebrow
    : `Backflush cleaning · Step ${stepNumber} of ${CLEANING_WIZARD_STEP_COUNT}`;

  const dots = kind === 'done'
    ? ''
    : `<div class="cleaning-wizard-dots">${Array.from({ length: CLEANING_WIZARD_STEP_COUNT }, (_, i) => {
        const cls = i < index ? 'done' : i === index ? 'active' : '';
        return `<span class="cleaning-wizard-dot ${cls}"></span>`;
      }).join('')}</div>`;

  const back = index > 0 && kind !== 'done'
    ? `<button type="button" class="cleaning-wizard-btn ghost" data-action="cleaning-wizard-back">${icon('chevron-left')}<span>Back</span></button>`
    : '';

  const noteHtml = model.note
    ? `<p class="cleaning-wizard-note">${escapeHtml(model.note)}</p>`
    : '';
  const profileHint = kind === 'pull' && !model.canRunPull
    ? `<p class="cleaning-wizard-note">No cleaning profile installed — pick one in the cleaning bar first.</p>`
    : '';

  const running = (kind === 'pull' && model.actionPending === 'pull') || (kind === 'flush' && model.actionPending === 'flush');
  const runningLabel = kind === 'flush' ? 'Flushing…' : 'Cleaning…';

  // GHC machines start flows only from the physical controller; the app loads
  // the profile and guides the user to the GHC.
  const ghcHint = model.hasGhc && (kind === 'pull' || kind === 'flush')
    ? `<p class="cleaning-wizard-hint">${escapeHtml(
        kind === 'flush'
          ? 'Your machine has a group-head controller — press its flush/rinse to rinse the group, then tap Done.'
          : 'Your machine has a group-head controller — after loading, press its espresso button to run the flush.'
      )}</p>`
    : '';

  let primary: string;
  let skip = '';
  if (running) {
    if (model.hasGhc) {
      // While the profile uploads, say "Loading…"; once it's on the machine,
      // tell the user to start it on the GHC.
      primary = model.loading
        ? `<button type="button" class="cleaning-wizard-btn primary" disabled><span class="cleaning-wizard-spinner" aria-hidden="true"></span><span>Loading profile…</span></button>`
        : `<button type="button" class="cleaning-wizard-btn primary" disabled>${icon('check')}<span>Loaded — press the GHC</span></button>`;
    } else {
      // The machine is running this step. Keep a manual "Done" so a missed
      // telemetry frame can never strand the user behind a spinner.
      primary = `<button type="button" class="cleaning-wizard-btn primary" disabled><span class="cleaning-wizard-spinner" aria-hidden="true"></span><span>${escapeHtml(runningLabel)}</span></button>`;
    }
    skip = `<button type="button" class="cleaning-wizard-btn ghost" data-action="cleaning-wizard-next">Done${model.step === 'pull-2' ? '' : ' ▸'}</button>`;
  } else if (kind === 'pull') {
    const label = model.hasGhc ? 'Load cleaning profile' : (copy.actionLabel ?? 'Run');
    primary = `<button type="button" class="cleaning-wizard-btn primary" data-action="cleaning-wizard-run-pull" ${model.canRunPull ? '' : 'disabled'}>${icon('refresh-cw')}<span>${escapeHtml(label)}</span></button>`;
    skip = `<button type="button" class="cleaning-wizard-btn ghost" data-action="cleaning-wizard-next">Skip</button>`;
  } else if (kind === 'flush' && model.hasGhc) {
    // No API flush on a GHC machine — it becomes a guided instruction step.
    primary = `<button type="button" class="cleaning-wizard-btn primary" data-action="cleaning-wizard-next"><span>Next</span>${icon('chevron-right')}</button>`;
  } else if (kind === 'flush') {
    primary = `<button type="button" class="cleaning-wizard-btn primary" data-action="cleaning-wizard-run-flush">${icon('droplet')}<span>${escapeHtml(copy.actionLabel ?? 'Run flush')}</span></button>`;
    skip = `<button type="button" class="cleaning-wizard-btn ghost" data-action="cleaning-wizard-next">Skip</button>`;
  } else if (kind === 'done') {
    primary = `<button type="button" class="cleaning-wizard-btn primary" data-action="close-modal">${icon('check')}<span>Done</span></button>`;
  } else {
    primary = `<button type="button" class="cleaning-wizard-btn primary" data-action="cleaning-wizard-next"><span>Next</span>${icon('chevron-right')}</button>`;
  }

  return `
    <div class="modal-backdrop cleaning-wizard-backdrop">
      <section class="modal panel cleaning-wizard-modal" role="dialog" aria-modal="true" aria-labelledby="cleaning-wizard-title">
        <div class="modal-head cleaning-wizard-head">
          <div>
            <span class="cleaning-wizard-eyebrow">${escapeHtml(eyebrow)}</span>
            <h2 id="cleaning-wizard-title">${escapeHtml(copy.title)}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <p class="cleaning-wizard-body">${escapeHtml(copy.body)}</p>
        ${noteHtml}
        ${profileHint}
        ${ghcHint}
        ${dots}
        <div class="cleaning-wizard-actions">
          ${back}
          <span class="cleaning-wizard-spacer"></span>
          ${skip}
          ${primary}
        </div>
      </section>
    </div>
  `;
}
