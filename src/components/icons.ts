import {
  Archive,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Beaker,
  Camera,
  ChevronDown,
  ChevronLeft,
  Check,
  Coffee,
  Copy,
  Delete,
  Droplet,
  Droplets,
  Gauge,
  History,
  KeyRound,
  LogIn,
  LogOut,
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
  Snowflake,
  Sparkles,
  Square,
  Sun,
  Thermometer,
  Trash2,
  Timer,
  Upload,
  Waves,
  X,
  createIcons
} from 'lucide';

const ICONS = {
  Archive,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Beaker,
  Camera,
  ChevronDown,
  ChevronLeft,
  Check,
  Coffee,
  Copy,
  Delete,
  Droplet,
  Droplets,
  Gauge,
  History,
  KeyRound,
  LogIn,
  LogOut,
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
  Snowflake,
  Sparkles,
  Square,
  Sun,
  Thermometer,
  Trash2,
  Timer,
  Upload,
  Waves,
  X
};

/**
 * PascalCase names of every icon `refreshIcons` registers. A `data-lucide`
 * placeholder only renders if its name is in here — see icons.test.ts, which
 * greps the source tree to keep this set in sync with `icon('...')` usage.
 */
export const registeredIconNames: ReadonlySet<string> = new Set(Object.keys(ICONS));

export function refreshIcons(): void {
  createIcons({ icons: ICONS });
}

export function icon(name: string): string {
  return `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
}
