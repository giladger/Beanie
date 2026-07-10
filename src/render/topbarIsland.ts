import { RenderChannel } from './renderChannel';
import type { StatViewModel, TopbarViewModel } from './topbarPresentation';

interface StatElements {
  value: HTMLElement;
  container: HTMLElement;
}

interface TopbarElements {
  owner: HTMLElement;
  machine: StatElements;
  group: StatElements;
  steam: StatElements;
  water: StatElements;
  scale: StatElements;
}

/**
 * Sole DOM owner for the high-frequency topbar stat subtree. Morphdom owns the
 * surrounding shell and treats #top-stats-island as opaque after its initial
 * mount. Complete stat models keep text, tone, title and accessibility metadata
 * consistent in one bounded commit.
 */
export class TopbarIsland {
  private elements: TopbarElements | null = null;
  private latest: TopbarViewModel | null = null;
  private readonly channel = new RenderChannel<TopbarViewModel>({
    minIntervalMs: 250,
    commit: (model) => this.commit(model)
  });

  bind(root: HTMLElement): void {
    const owner = root.querySelector<HTMLElement>('#top-stats-island');
    const next = owner ? elementsFrom(owner) : null;
    const changed = next?.owner !== this.elements?.owner;
    this.elements = next;
    // A newly mounted owner has template values but no committed island state.
    // Apply the latest complete model immediately; individual property gates
    // make this free when the template already matches.
    if (changed && this.latest) this.commit(this.latest);
  }

  offer(model: TopbarViewModel): void {
    this.latest = model;
    this.channel.offer(model);
  }

  flush(): void {
    this.channel.flush();
  }

  dispose(): void {
    this.channel.dispose();
    this.elements = null;
    this.latest = null;
  }

  private commit(model: TopbarViewModel): void {
    const elements = this.elements;
    if (!elements) return;
    commitStat(elements.machine, model.machine);
    commitStat(elements.group, model.group);
    commitStat(elements.steam, model.steam);
    commitStat(elements.water, model.water);
    commitStat(elements.scale, model.scale);
  }
}

function elementsFrom(owner: HTMLElement): TopbarElements | null {
  const machine = statElements(owner, '#stat-machine');
  const group = statElements(owner, '#stat-group');
  const steam = statElements(owner, '#stat-steam');
  const water = statElements(owner, '#stat-water');
  const scale = statElements(owner, '#stat-scale');
  return machine && group && steam && water && scale
    ? { owner, machine, group, steam, water, scale }
    : null;
}

function statElements(owner: HTMLElement, selector: string): StatElements | null {
  const value = owner.querySelector<HTMLElement>(selector);
  const container = value?.parentElement ?? null;
  return value && container ? { value, container } : null;
}

function commitStat(elements: StatElements, model: StatViewModel): void {
  if (elements.value.textContent !== model.text) elements.value.textContent = model.text;
  if (elements.container.className !== model.className) {
    elements.container.className = model.className;
  }
  if (elements.container.getAttribute('title') !== model.title) {
    if (model.title) elements.container.setAttribute('title', model.title);
    else elements.container.removeAttribute('title');
  }
  if (elements.container.getAttribute('aria-label') !== model.ariaLabel) {
    elements.container.setAttribute('aria-label', model.ariaLabel);
  }
}
