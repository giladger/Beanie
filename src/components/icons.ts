import {
  Archive,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Bean,
  Beaker,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleCheck,
  Coffee,
  Copy,
  Delete,
  Droplet,
  Droplets,
  Eye,
  EyeOff,
  Gauge,
  Ghost,
  GitCompareArrows,
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
} from 'lucide';

// Each lucide icon is a flat [tag, attrs][] node list (no nesting), so the
// final <svg> markup can be built as a string at template time. This replaces
// the old two-step scheme — emit `<i data-lucide>` placeholders, then have
// lucide's createIcons() swap them in a full-DOM scan after every render —
// which also meant the live DOM never matched the rendered template.
type IconNode = ReadonlyArray<readonly [string, Record<string, string | number>]>;

const ICONS: Record<string, IconNode> = {
  Archive,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Bean,
  Beaker,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleCheck,
  Coffee,
  Copy,
  Delete,
  Droplet,
  Droplets,
  Eye,
  EyeOff,
  Gauge,
  Ghost,
  GitCompareArrows,
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
 * PascalCase names of every icon `icon()` can render. A name outside this set
 * renders an empty placeholder — see icons.test.ts, which greps the source
 * tree to keep this set in sync with `icon('...')` usage.
 */
export const registeredIconNames: ReadonlySet<string> = new Set(Object.keys(ICONS));

// Matches lucide's own default svg attributes, so the markup is identical to
// what createIcons() used to produce (minus the lucide-* bookkeeping classes,
// which nothing styles).
const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

// Mirrors lucide's toPascalCase ('log-in' -> 'LogIn', 'trash-2' -> 'Trash2').
function toPascalCase(name: string): string {
  return name.replace(/(\w)(\w*)(_|-|\s*)/g, (_m, first: string, rest: string) => first.toUpperCase() + rest.toLowerCase());
}

function escapeAttr(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const svgCache = new Map<string, string>();

export function icon(name: string): string {
  const cached = svgCache.get(name);
  if (cached) return cached;
  const node = ICONS[toPascalCase(name)];
  // Same visible result as an unregistered data-lucide placeholder: an empty
  // 16x16 inline box. icons.test.ts pins that no real usage hits this.
  const svg = node
    ? `<svg class="icon" data-icon="${escapeAttr(name)}" ${SVG_ATTRS} aria-hidden="true">${node
        .map(([tag, attrs]) => {
          const attrText = Object.entries(attrs)
            .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
            .join(' ');
          return `<${tag} ${attrText}></${tag}>`;
        })
        .join('')}</svg>`
    : '<span class="icon" aria-hidden="true"></span>';
  svgCache.set(name, svg);
  return svg;
}
