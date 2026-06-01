import {
  Archive,
  Coffee,
  Delete,
  History,
  Minus,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
  createIcons
} from 'lucide';

export function refreshIcons(): void {
  createIcons({
    icons: {
      Archive,
      Coffee,
      Delete,
      History,
      Minus,
      Pencil,
      Play,
      Plus,
      Power,
      RefreshCw,
      RotateCcw,
      Save,
      Search,
      Settings,
      SlidersHorizontal,
      Trash2,
      X
    }
  });
}

export function icon(name: string): string {
  return `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
}
