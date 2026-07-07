import type { ShotAnnotations, ShotRecord } from '../api/types';
import type { DialInSuggestion } from './dialIn';

// Derek's advice lives ON the shot it was asked about, under
// `annotations.extras.derek` — the gateway round-trips extras, so answers and
// the tip the user chose survive reloads and sync across devices:
//
//   extras.derek = {
//     answers: [{ at, asked, answer, suggestions }],   // newest last, capped
//     applied: { parameter, target, unit, summary, at, profileId?, profileTitle? }
//   }
//   extras.derekTweak = "Preinfusion time 8s → 13s"    // the change this shot
//                                                       // was PULLED with
//
// `answers` is what "come back to it later" reopens; `applied` is the tip that
// re-applies when the shot's recipe is loaded again.

export interface SavedDerekAnswer {
  at: string;
  /** What was asked, in one line ("sour, too fast · second bag"). */
  asked: string;
  /** The prose answer, citation markers stripped and JSON fence removed. */
  answer: string;
  suggestions: DialInSuggestion[];
}

export interface AppliedDerekTip {
  parameter: string;
  target: number | string;
  unit: string | null;
  summary: string;
  at: string;
  /** For profile-level tips: the variant profile the recipe switched to. */
  profileId?: string | null;
  profileTitle?: string | null;
}

export interface ShotDerekData {
  answers: SavedDerekAnswer[];
  applied: AppliedDerekTip | null;
}

const MAX_SAVED_ANSWERS = 3;

export function readShotDerek(shot: ShotRecord | null | undefined): ShotDerekData {
  const raw = derekExtras(shot?.annotations);
  const answers = Array.isArray(raw?.answers)
    ? (raw.answers as unknown[]).filter(isSavedAnswer)
    : [];
  const applied = isAppliedTip(raw?.applied) ? (raw.applied as AppliedDerekTip) : null;
  return { answers, applied };
}

/** True when the shot carries any Derek history — drives the list markers. */
export function isDerekedShot(shot: ShotRecord | null | undefined): boolean {
  if (!shot) return false;
  const extras = shot.annotations?.extras;
  if (extras && typeof extras === 'object' && typeof (extras as Record<string, unknown>).derekTweak === 'string') {
    return true;
  }
  const derek = readShotDerek(shot);
  return derek.answers.length > 0 || derek.applied != null;
}

export function annotationsWithDerekAnswer(
  annotations: ShotAnnotations | null | undefined,
  answer: SavedDerekAnswer
): ShotAnnotations {
  const current = readShotDerekFromAnnotations(annotations);
  const answers = [...current.answers, answer].slice(-MAX_SAVED_ANSWERS);
  return withDerek(annotations, { answers, applied: current.applied });
}

export function annotationsWithAppliedTip(
  annotations: ShotAnnotations | null | undefined,
  applied: AppliedDerekTip
): ShotAnnotations {
  const current = readShotDerekFromAnnotations(annotations);
  return withDerek(annotations, { answers: current.answers, applied });
}

export function latestDerekAnswer(shot: ShotRecord | null | undefined): SavedDerekAnswer | null {
  const { answers } = readShotDerek(shot);
  return answers.length > 0 ? answers[answers.length - 1]! : null;
}

function withDerek(
  annotations: ShotAnnotations | null | undefined,
  derek: ShotDerekData
): ShotAnnotations {
  return {
    ...annotations,
    extras: {
      ...annotations?.extras,
      derek: {
        answers: derek.answers,
        ...(derek.applied ? { applied: derek.applied } : {})
      }
    }
  };
}

function readShotDerekFromAnnotations(annotations: ShotAnnotations | null | undefined): ShotDerekData {
  const raw = derekExtras(annotations);
  return {
    answers: Array.isArray(raw?.answers) ? (raw.answers as unknown[]).filter(isSavedAnswer) : [],
    applied: isAppliedTip(raw?.applied) ? (raw.applied as AppliedDerekTip) : null
  };
}

function derekExtras(
  annotations: ShotAnnotations | null | undefined
): Record<string, unknown> | null {
  const extras = annotations?.extras;
  if (!extras || typeof extras !== 'object') return null;
  const derek = (extras as Record<string, unknown>).derek;
  return derek && typeof derek === 'object' ? (derek as Record<string, unknown>) : null;
}

function isSavedAnswer(value: unknown): value is SavedDerekAnswer {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.at === 'string' &&
    typeof item.asked === 'string' &&
    typeof item.answer === 'string' &&
    Array.isArray(item.suggestions)
  );
}

function isAppliedTip(value: unknown): value is AppliedDerekTip {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.parameter === 'string' &&
    (typeof item.target === 'number' || typeof item.target === 'string') &&
    typeof item.summary === 'string' &&
    typeof item.at === 'string'
  );
}
