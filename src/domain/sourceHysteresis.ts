/**
 * Holds a noisy finite sensor in its continuous source unit. Unknown/recovery
 * transitions are immediate; otherwise a reading is accepted only after it
 * moves the configured distance from the last accepted source value.
 */
export class SourceHysteresis {
  private initialized = false;
  private accepted: number | null = null;

  constructor(private readonly threshold: number) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error('Source hysteresis threshold must be a finite positive number');
    }
  }

  update(source: number | null | undefined): number | null {
    const next = typeof source === 'number' && Number.isFinite(source) ? source : null;
    if (
      !this.initialized ||
      next == null ||
      this.accepted == null ||
      Math.abs(next - this.accepted) >= this.threshold
    ) {
      this.initialized = true;
      this.accepted = next;
    }
    return this.accepted;
  }

  reset(): void {
    this.initialized = false;
    this.accepted = null;
  }
}
