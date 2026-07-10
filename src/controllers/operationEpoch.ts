/**
 * Monotonic ownership token for async UI operations. Closing/reopening a flow
 * invalidates every continuation from the old semantic session, even when its
 * local counters or entity ids happen to repeat.
 */
export class OperationEpoch {
  private value = 0;

  begin(): number {
    this.value += 1;
    return this.value;
  }

  invalidate(): void {
    this.value += 1;
  }

  owns(token: number): boolean {
    return token === this.value;
  }
}
