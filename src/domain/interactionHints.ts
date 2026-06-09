const secondTapHintStorageKey = 'beanie:second-tap-hint-v3';

// The "tap again to load" hint sticks around until the gesture has been used
// this many times, so it keeps reminding new users across several sessions.
export const secondTapHintUsesBeforeHiding = 10;

export type SecondTapHintKind = 'bean' | 'shot';

interface SecondTapHintPrefs {
  beanUses: number;
  shotUses: number;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readSecondTapHintPrefs(): SecondTapHintPrefs {
  try {
    const raw = localStorage.getItem(secondTapHintStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      beanUses: readCount(parsed?.beanUses),
      shotUses: readCount(parsed?.shotUses)
    };
  } catch {
    return { beanUses: 0, shotUses: 0 };
  }
}

function writeSecondTapHintPrefs(prefs: SecondTapHintPrefs): void {
  try {
    localStorage.setItem(secondTapHintStorageKey, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures; the hint is purely instructional.
  }
}

export function shouldShowSecondTapHint(kind: SecondTapHintKind): boolean {
  const prefs = readSecondTapHintPrefs();
  const uses = kind === 'bean' ? prefs.beanUses : prefs.shotUses;
  return uses < secondTapHintUsesBeforeHiding;
}

export function markSecondTapHintUsed(kind: SecondTapHintKind): void {
  const prefs = readSecondTapHintPrefs();
  if (kind === 'bean') {
    if (prefs.beanUses >= secondTapHintUsesBeforeHiding) return;
    writeSecondTapHintPrefs({ ...prefs, beanUses: prefs.beanUses + 1 });
    return;
  }
  if (prefs.shotUses >= secondTapHintUsesBeforeHiding) return;
  writeSecondTapHintPrefs({ ...prefs, shotUses: prefs.shotUses + 1 });
}
