import type { MachineSettingsChange } from '../domain/machineSettings';

type SettingsControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Translate settings controls into DOM-free flow intents. */
export function readMachineSettingsChange(target: SettingsControl): MachineSettingsChange | null {
  switch (target.dataset.action) {
    case 'settings-field':
      return {
        type: 'field',
        group: target.dataset.group ?? '',
        key: target.dataset.key ?? '',
        raw: target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value
      };
    case 'settings-display-brightness':
      return { type: 'display-brightness', raw: target.value };
    case 'settings-water-soft':
      return { type: 'water-soft-limit', raw: target.value };
    case 'settings-topbar-clock':
      return { type: 'topbar-clock', enabled: checked(target) };
    case 'settings-machine-refill':
      return { type: 'machine-refill', raw: target.value };
    case 'no-scale-block-toggle':
      return { type: 'no-scale-block', enabled: checked(target) };
    case 'settings-schedule-toggle':
      return {
        type: 'schedule-toggle',
        id: target.dataset.id ?? '',
        enabled: checked(target)
      };
    case 'settings-firmware': {
      const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
      return file ? { type: 'firmware', file } : null;
    }
    default:
      return null;
  }
}

function checked(target: SettingsControl): boolean {
  return target instanceof HTMLInputElement && target.checked;
}
