import { RenderChannel } from './renderChannel';

export interface DerekStreamViewModel {
  readonly sessionId: number;
  readonly answerText: string;
  readonly phase: string;
  readonly showShimmer: boolean;
}

interface DerekStreamElements {
  owner: HTMLElement;
  answer: HTMLElement;
  phase: HTMLElement;
  shimmer: HTMLElement;
  body: HTMLElement | null;
}

/**
 * Sole DOM owner for Derek's token stream. The controller publishes complete
 * presentation frames; this island coalesces them to at most 20 paints/second
 * and scrolls only when the rendered answer actually changes.
 */
export class DerekStreamIsland {
  private elements: DerekStreamElements | null = null;
  private answerText = '';
  private phase = '';
  private showShimmer = false;
  private sessionId: number | null = null;
  private readonly channel = new RenderChannel<DerekStreamViewModel>({
    minIntervalMs: 50,
    equals: (previous, next) =>
      previous.sessionId === next.sessionId &&
      previous.answerText === next.answerText &&
      previous.phase === next.phase &&
      previous.showShimmer === next.showShimmer,
    commit: (model) => this.commit(model)
  });

  bind(root: HTMLElement): void {
    const owner = root.querySelector<HTMLElement>('#derek-stream-island');
    const answer = owner?.querySelector<HTMLElement>('#derek-answer-stream') ?? null;
    const phase = owner?.querySelector<HTMLElement>('#derek-phase') ?? null;
    const shimmer = owner?.querySelector<HTMLElement>('#derek-shimmer') ?? null;
    const next = owner && answer && phase && shimmer
      ? { owner, answer, phase, shimmer, body: owner.closest<HTMLElement>('.derek-body') }
      : null;
    if (next?.owner === this.elements?.owner) return;
    this.channel.reset();
    this.sessionId = null;
    this.elements = next;
    // A newly mounted modal is already authoritative template output. Seed the
    // gates from it; never replay a previous ask into a newly opened modal.
    this.answerText = next?.answer.textContent ?? '';
    this.phase = next?.phase.textContent ?? '';
    this.showShimmer = next ? !next.shimmer.hidden : false;
  }

  offer(model: DerekStreamViewModel): void {
    if (model.sessionId !== this.sessionId) {
      this.channel.reset();
      this.sessionId = model.sessionId;
    }
    this.channel.offer(model);
  }

  suspend(): void {
    this.channel.suspend();
  }

  resume(): void {
    this.channel.resume();
  }

  dispose(): void {
    this.channel.dispose();
    this.elements = null;
    this.answerText = '';
    this.phase = '';
    this.showShimmer = false;
    this.sessionId = null;
  }

  private commit(model: DerekStreamViewModel): void {
    const elements = this.elements;
    if (!elements) return;
    if (this.answerText !== model.answerText) {
      this.answerText = model.answerText;
      elements.answer.textContent = model.answerText;
      if (elements.body && elements.body.scrollTop !== elements.body.scrollHeight) {
        elements.body.scrollTop = elements.body.scrollHeight;
      }
    }
    if (this.phase !== model.phase) {
      this.phase = model.phase;
      elements.phase.textContent = model.phase;
    }
    if (this.showShimmer !== model.showShimmer) {
      this.showShimmer = model.showShimmer;
      elements.shimmer.hidden = !model.showShimmer;
    }
  }
}
