import morphdom from 'morphdom';

// The app's render pipeline: morph the existing DOM to match freshly built
// markup instead of rebuilding it, so focus, scroll positions, canvases, and
// input state survive renders. This module owns the morph policy and the
// focus fallback; app.ts owns building the markup.
//
// Rule that lives here (see docs/render-ownership-architecture.md): in the
// in-process Android WebView, any redundant DOM write is a GPU-memory leak
// risk. The morph must only touch nodes that actually changed.

// Input types that aren't free-text entry — focus on these is a click target,
// not a caret, so they're excluded from the across-render focus restore.
const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'
]);

// A field the user types into: <textarea>, contenteditable, or a text-like
// <input>. These are exactly the elements where losing focus mid-render is a
// bug; buttons, steppers, toggles, and sliders are deliberately excluded.
export function isTextEntryElement(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return false;
}

// Morph-time policy for elements that outlive a render.
const onBeforeElUpdated = (fromEl: HTMLElement, toEl: HTMLElement): boolean => {
  // Identical subtree: nothing to do, skip the whole branch.
  if (fromEl.isEqualNode(toEl)) return false;
  // Charts draw imperatively and size their canvas for DPR — the template's
  // bare <canvas> must never overwrite a live one.
  if (fromEl instanceof HTMLCanvasElement) return false;
  // Escape hatch for imperative islands.
  if (fromEl.dataset.morphSkip != null) return false;
  // For the field being typed in, the DOM is the sole owner until focus leaves.
  // Skip the element rather than copying its value into `toEl`: morphdom's
  // TEXTAREA handler writes `toEl.value` back into the surviving text child,
  // which also changes `defaultValue` and makes an unsaved textarea look clean.
  // Attribute/class changes can wait for the first render after focus leaves.
  if (fromEl === document.activeElement && isTextEntryElement(fromEl)) {
    return false;
  }
  // The bean create/edit form is uncontrolled — its text lives only in the
  // DOM until submit/blur. Keep a dirty field's (value differs from its
  // rendered default) in-progress text across a background render; clean
  // fields still adopt fresh template values (a just-saved edit, or a change
  // synced from another device).
  if (
    (fromEl instanceof HTMLInputElement || fromEl instanceof HTMLTextAreaElement) &&
    fromEl.value !== fromEl.defaultValue &&
    fromEl.closest('form[data-form="bean-picker-bean"]') != null
  ) return false;
  return true;
};

// Morph the root's single child to match `html`. The first render (empty
// root) falls back to innerHTML. Elements with ids are matched by id even
// when siblings shift, so keyed rows diff correctly.
export function morphRender(root: HTMLElement, html: string): void {
  const current = root.firstElementChild;
  if (current) {
    morphdom(current, html, { onBeforeElUpdated });
  } else {
    root.innerHTML = html;
  }
}

export interface FocusSnapshot {
  selector: string;
  start: number | null;
  value: string | null;
}

// The morphing render keeps a focused text field alive in place, so focus,
// caret, and value normally survive on their own. This is the fallback for
// the rare render where a structural change really did replace the focused
// element (an unkeyed subtree reshuffle): re-find the field by its most
// stable identity and put focus, caret, and in-progress value back. It
// no-ops whenever the element survived. Opt out with data-no-focus-restore.
export function captureFocus(): FocusSnapshot | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !isTextEntryElement(active)) return null;
  if (active.dataset.noFocusRestore != null) return null;
  // Anchor the restore selector on the most stable identifier the field has.
  const name = active.getAttribute('name');
  const anchor = active.dataset.action != null
    ? `[data-action="${active.dataset.action}"]`
    : name
    ? `[name="${name}"]`
    : active.id
    ? `#${CSS.escape(active.id)}`
    : null;
  if (!anchor) return null;
  const batchForm = active.closest<HTMLFormElement>('[data-form="bean-picker-batch"]');
  const parts = batchForm?.dataset.batchId != null
    ? [`[data-form="bean-picker-batch"][data-batch-id="${batchForm.dataset.batchId}"] ${anchor}`]
    : [anchor];
  if (active.dataset.field != null) parts.push(`[data-field="${active.dataset.field}"]`);
  if (active.dataset.index != null) parts.push(`[data-index="${active.dataset.index}"]`);
  if (active.dataset.key != null) parts.push(`[data-key="${active.dataset.key}"]`);
  // Add name as a disambiguator only when it isn't already the anchor.
  if (active.dataset.action != null && name != null) parts.push(`[name="${name}"]`);
  if (active.dataset.type != null) parts.push(`[data-type="${active.dataset.type}"]`);
  if (active.dataset.condition != null) parts.push(`[data-condition="${active.dataset.condition}"]`);
  const input = active as HTMLInputElement | HTMLTextAreaElement;
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : null;
  // Capture the in-progress value too, so a replaced uncontrolled field gets
  // its typed-but-uncommitted text back instead of the saved value.
  const value = typeof input.value === 'string' ? input.value : null;
  return { selector: parts.join(''), start, value };
}

export function restoreFocus(root: HTMLElement, focus: FocusSnapshot | null): void {
  if (!focus) return;
  // Only restore when the selector still resolves to exactly one field, so an
  // ambiguous match can never drop the caret into the wrong box.
  const matches = root.querySelectorAll<HTMLInputElement>(focus.selector);
  if (matches.length !== 1) return;
  const el = matches[0];
  // The element survived the morph and is still focused — leave it alone
  // (re-focusing would collapse a selection the user dragged).
  if (el === document.activeElement) return;
  if (focus.value != null && el.value !== focus.value) el.value = focus.value;
  el.focus();
  if (focus.start != null) {
    try {
      el.setSelectionRange(focus.start, focus.start);
    } catch {
      /* not a text input */
    }
  }
}
