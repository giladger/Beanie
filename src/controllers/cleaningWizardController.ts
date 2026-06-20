// Pure state machine for the guided backflush cleaning wizard. The wizard walks
// the user through a DE1 detergent backflush: load a blind basket, run the
// cleaning (forward-flush) profile, remove the portafilter, flush the group,
// rinse the basket and refit it, and run the profile once more. The action
// steps drive the real machine from app.ts; this module owns only the step
// ordering and the auto-advance decisions taken when a pull or flush finishes.
//
// Each instruction step is immediately followed by a machine action, so tapping
// Next always leads to something the machine does (no two prep steps in a row).

export type CleaningWizardStep =
  | 'solution'
  | 'pull-1'
  | 'remove'
  | 'flush'
  | 'rinse-refit'
  | 'pull-2'
  | 'done';

export type CleaningWizardStepKind = 'instruction' | 'pull' | 'flush' | 'done';

/** Ordered steps. 'done' is the terminal confirmation screen. */
export const CLEANING_WIZARD_STEPS: readonly CleaningWizardStep[] = [
  'solution',
  'pull-1',
  'remove',
  'flush',
  'rinse-refit',
  'pull-2',
  'done'
];

/** Guided steps shown in the progress indicator (everything before 'done'). */
export const CLEANING_WIZARD_STEP_COUNT = CLEANING_WIZARD_STEPS.length - 1;

export interface CleaningWizardState {
  step: CleaningWizardStep;
  /** An action started from the current step is running on the machine. */
  actionPending: 'pull' | 'flush' | null;
  /** Inline dialog message, e.g. why an action could not start. */
  note: string | null;
}

export type CleaningWizardAdvance =
  | { type: 'advance'; next: CleaningWizardState }
  | { type: 'stay' };

export function cleaningWizardStepKind(step: CleaningWizardStep): CleaningWizardStepKind {
  if (step === 'pull-1' || step === 'pull-2') return 'pull';
  if (step === 'flush') return 'flush';
  if (step === 'done') return 'done';
  return 'instruction';
}

export function cleaningWizardStepIndex(step: CleaningWizardStep): number {
  const index = CLEANING_WIZARD_STEPS.indexOf(step);
  return index < 0 ? 0 : index;
}

export function startCleaningWizard(): CleaningWizardState {
  return { step: 'solution', actionPending: null, note: null };
}

export function cleaningWizardNext(state: CleaningWizardState): CleaningWizardState {
  const index = cleaningWizardStepIndex(state.step);
  const next = CLEANING_WIZARD_STEPS[Math.min(index + 1, CLEANING_WIZARD_STEPS.length - 1)]!;
  return { step: next, actionPending: null, note: null };
}

export function cleaningWizardBack(state: CleaningWizardState): CleaningWizardState {
  const index = cleaningWizardStepIndex(state.step);
  const prev = CLEANING_WIZARD_STEPS[Math.max(index - 1, 0)]!;
  return { step: prev, actionPending: null, note: null };
}

/** A cleaning (espresso) pull finished. Advance only if this wizard started it. */
export function cleaningWizardOnPullComplete(state: CleaningWizardState): CleaningWizardAdvance {
  if (state.actionPending !== 'pull') return { type: 'stay' };
  if (state.step === 'pull-1') {
    return { type: 'advance', next: { step: 'remove', actionPending: null, note: null } };
  }
  if (state.step === 'pull-2') {
    return { type: 'advance', next: { step: 'done', actionPending: null, note: null } };
  }
  return { type: 'stay' };
}

/** A flush finished. Advance only if this wizard started it. */
export function cleaningWizardOnFlushComplete(state: CleaningWizardState): CleaningWizardAdvance {
  if (state.actionPending !== 'flush') return { type: 'stay' };
  if (state.step === 'flush') {
    return { type: 'advance', next: { step: 'rinse-refit', actionPending: null, note: null } };
  }
  return { type: 'stay' };
}
