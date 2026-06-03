import {
  Archive,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Beaker,
  ChevronLeft,
  Coffee,
  Copy,
  Delete,
  Droplets,
  Gauge,
  History,
  Minus,
  MoveRight,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Thermometer,
  Trash2,
  Timer,
  Waves,
  X,
  createIcons
} from 'lucide';

export function refreshIcons(): void {
  createIcons({
    icons: {
      Archive,
      ArrowDownToLine,
      ArrowDown,
      ArrowUp,
      ArrowUpToLine,
      Beaker,
      ChevronLeft,
      Coffee,
      Copy,
      Delete,
      Droplets,
      Gauge,
      History,
      Minus,
      MoveRight,
      Pencil,
      Play,
      Plus,
      Power,
      RefreshCw,
      RotateCcw,
      Save,
      Scale,
      Search,
      Settings,
      SlidersHorizontal,
      Square,
      Thermometer,
      Trash2,
      Timer,
      Waves,
      X
    }
  });
}

export function icon(name: string): string {
  return `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
}
