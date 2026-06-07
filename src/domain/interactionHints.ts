const secondTapHintStorageKey = 'beanie:second-tap-hint-v2';

export type SecondTapHintKind = 'bean' | 'shot';

interface SecondTapHintPrefs {
  beanUsed: boolean;
  shotUsed: boolean;
}

function readSecondTapHintPrefs(): SecondTapHintPrefs {
  try {
    const raw = localStorage.getItem(secondTapHintStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      beanUsed: parsed?.beanUsed === true,
      shotUsed: parsed?.shotUsed === true
    };
  } catch {
    return { beanUsed: false, shotUsed: false };
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
  return kind === 'bean' ? !prefs.beanUsed : !prefs.shotUsed;
}

export function markSecondTapHintUsed(kind: SecondTapHintKind): void {
  const prefs = readSecondTapHintPrefs();
  if (kind === 'bean') {
    if (prefs.beanUsed) return;
    writeSecondTapHintPrefs({ ...prefs, beanUsed: true });
    return;
  }
  if (prefs.shotUsed) return;
  writeSecondTapHintPrefs({ ...prefs, shotUsed: true });
}
