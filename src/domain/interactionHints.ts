import { getSyncedItem, secondTapHintKey as secondTapHintStorageKey, setSyncedItem } from './settingsStore';

// The "tap again to load" hint sticks around until the gesture has been used
// this many times, so it keeps reminding new users across several sessions.
export const secondTapHintUsesBeforeHiding = 20;

export type SecondTapHintKind = 'bean' | 'shot' | 'profile';

type SecondTapHintPrefs = Record<SecondTapHintKind, number>;

const HINT_KINDS: readonly SecondTapHintKind[] = ['bean', 'shot', 'profile'];

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readSecondTapHintPrefs(): SecondTapHintPrefs {
  try {
    const raw = getSyncedItem(secondTapHintStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      // `beanUses`/`shotUses`/`profileUses` are stored per gesture.
      bean: readCount(parsed?.beanUses),
      shot: readCount(parsed?.shotUses),
      profile: readCount(parsed?.profileUses)
    };
  } catch {
    return { bean: 0, shot: 0, profile: 0 };
  }
}

function writeSecondTapHintPrefs(prefs: SecondTapHintPrefs): void {
  setSyncedItem(
    secondTapHintStorageKey,
    JSON.stringify({ beanUses: prefs.bean, shotUses: prefs.shot, profileUses: prefs.profile })
  );
}

export function shouldShowSecondTapHint(kind: SecondTapHintKind): boolean {
  return readSecondTapHintPrefs()[kind] < secondTapHintUsesBeforeHiding;
}

export function markSecondTapHintUsed(kind: SecondTapHintKind): void {
  if (!HINT_KINDS.includes(kind)) return;
  const prefs = readSecondTapHintPrefs();
  if (prefs[kind] >= secondTapHintUsesBeforeHiding) return;
  writeSecondTapHintPrefs({ ...prefs, [kind]: prefs[kind] + 1 });
}
