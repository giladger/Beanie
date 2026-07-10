import { DerekStreamIsland } from '../render/derekStreamIsland';

class FakeElement {
  hidden = false;
  scrollTop = 0;
  scrollHeight = 240;
  htmlWrites = 0;
  textWrites = 0;
  private html = '';
  private text = '';
  private readonly matches = new Map<string, FakeElement>();
  closestResult: FakeElement | null = null;

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.htmlWrites += 1;
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    this.textWrites += 1;
  }

  querySelector(selector: string): FakeElement | null {
    return this.matches.get(selector) ?? null;
  }

  setMatch(selector: string, value: FakeElement): void {
    this.matches.set(selector, value);
  }

  closest(): FakeElement | null {
    return this.closestResult;
  }
}

run('Derek stream island gates token presentation and owns auto-scroll', () => {
  const root = new FakeElement();
  const owner = new FakeElement();
  const answer = new FakeElement();
  const phase = new FakeElement();
  const body = new FakeElement();
  const shimmer = new FakeElement();
  owner.closestResult = body;
  owner.setMatch('#derek-answer-stream', answer);
  owner.setMatch('#derek-phase', phase);
  owner.setMatch('#derek-shimmer', shimmer);
  root.setMatch('#derek-stream-island', owner);

  const island = new DerekStreamIsland();
  island.bind(root as unknown as HTMLElement);
  const model = {
    sessionId: 1,
    answerText: 'Dial finer.',
    phase: 'Reading the shot…',
    showShimmer: false
  };
  island.offer(model);
  equal(answer.textContent, model.answerText);
  equal(phase.textContent, model.phase);
  equal(body.scrollTop, body.scrollHeight);

  const writes = answer.textWrites + phase.textWrites;
  island.offer({ ...model });
  equal(answer.textWrites + phase.textWrites, writes);

  // A pending old-session frame is cancelled; the first frame of the next ask
  // paints immediately even though it arrives inside the 50 ms budget.
  island.offer({ ...model, answerText: 'stale pending' });
  island.offer({
    sessionId: 2,
    answerText: 'Fresh answer.',
    phase: 'Preparing suggestions…',
    showShimmer: true
  });
  equal(answer.textContent, 'Fresh answer.');
  equal(shimmer.hidden, false);
  island.dispose();
});

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
