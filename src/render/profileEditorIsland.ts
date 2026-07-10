/**
 * Owns the live value label while a profile range input is being dragged.
 * The surrounding form deliberately does not morph until the change event.
 */
export function patchProfileRangeValue(range: HTMLInputElement): void {
  const value = range.closest('.pe-ctl')?.querySelector<HTMLElement>('.pe-ctl-value');
  if (!value || value.firstChild?.textContent === range.value) return;
  const unit = value.querySelector('em');
  value.textContent = range.value;
  if (unit) value.appendChild(unit);
}
