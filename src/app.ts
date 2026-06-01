import type {
  Bean,
  BeanBatch,
  BeanPreset,
  Grinder,
  MachineSnapshot,
  MachineState,
  ProfileRecord,
  RecipeDraft,
  ScaleSnapshot,
  ShotRecord,
  ShotSummary,
  Workflow
} from './api/types';
import { gateway, gatewayWsOrigin } from './api/gateway';
import {
  beanLabel,
  buildWorkflowUpdate,
  emptyRecipe,
  formatGrams,
  latestBatch,
  normalizeDraft,
  parseNumberInput,
  presetName,
  recipeFromShot,
  recipeFromWorkflow,
  selectInitialBean,
  shotFilterForBean
} from './domain/beanWorkflow';
import {
  readAutoLoad,
  readLastBeanId,
  readPresets,
  writeAutoLoad,
  writeLastBeanId,
  writePresets
} from './domain/storage';
import {
  demoBatches,
  demoBeans,
  demoGrinders,
  demoMachine,
  demoProfiles,
  demoShotsForBean,
  demoWorkflow
} from './mock/demo';
import { icon, refreshIcons } from './components/icons';
import { renderShotGraph } from './components/ShotGraph';

type Modal = 'add-bean' | 'settings' | 'edit-number' | 'shot-detail' | null;
type EditField = 'dose' | 'yield' | 'grinderSetting';

interface EditDialog {
  field: EditField;
  title: string;
  value: string;
  step: number;
}

interface AppState {
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  grinders: Grinder[];
  profiles: ProfileRecord[];
  workflow: Workflow | null;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  shots: ShotRecord[];
  draft: RecipeDraft;
  presets: BeanPreset[];
  search: string;
  autoLoad: boolean;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  status: string;
  modal: Modal;
  editDialog: EditDialog | null;
  detailShotId: string | null;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
}

export class BeanieApp {
  private state: AppState = {
    beans: [],
    batchesByBean: {},
    grinders: [],
    profiles: [],
    workflow: null,
    selectedBeanId: null,
    selectedBatchId: null,
    shots: [],
    draft: emptyRecipe(),
    presets: [],
    search: '',
    autoLoad: readAutoLoad(),
    demo: false,
    loading: true,
    busy: false,
    status: 'Starting',
    modal: null,
    editDialog: null,
    detailShotId: null,
    machine: null,
    scale: null
  };

  private renderTimer: number | null = null;
  private machineRetryTimer: number | null = null;
  private scaleRetryTimer: number | null = null;
  private machineSocket: WebSocket | null = null;
  private scaleSocket: WebSocket | null = null;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.root.addEventListener('click', (event) => void this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('change', (event) => void this.onChange(event));
    this.root.addEventListener('submit', (event) => void this.onSubmit(event));
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.setState({ loading: true, status: 'Loading Decent.app data' });
    try {
      const latestShotQuery = new URLSearchParams({ limit: '1', offset: '0', order: 'desc' });
      const [workflow, beans, grinders, profiles, latestShots] = await Promise.all([
        gateway.workflow(),
        gateway.beans(),
        gateway.grinders(),
        gateway.profiles(),
        gateway.shots(latestShotQuery)
      ]);

      this.setState({
        workflow,
        beans,
        grinders,
        profiles,
        demo: false,
        loading: false,
        status: 'Connected'
      });

      const selected = selectInitialBean(beans, workflow, readLastBeanId(), latestShots.items[0]);
      if (selected) {
        await this.selectBean(selected.id, {
          apply: this.state.autoLoad && !this.workflowMatchesBean(selected),
          preferWorkflow: true
        });
      }
      this.connectMachineSocket();
      this.connectScaleSocket();
    } catch (error) {
      console.warn('[Beanie] Gateway unavailable; using demo data', error);
      this.loadDemo();
    }
  }

  private loadDemo(): void {
    this.setState({
      workflow: demoWorkflow,
      beans: demoBeans,
      batchesByBean: demoBatches,
      grinders: demoGrinders,
      profiles: demoProfiles,
      machine: demoMachine,
      demo: true,
      loading: false,
      status: 'Demo data'
    });
    void this.selectBean(demoBeans[0]!.id, { apply: false, preferWorkflow: true });
  }

  private async selectBean(
    beanId: string,
    options: { apply: boolean; preferWorkflow: boolean }
  ): Promise<void> {
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;

    writeLastBeanId(bean.id);
    this.setState({
      selectedBeanId: bean.id,
      busy: true,
      status: `Loading ${beanLabel(bean)}`
    });

    const batches = await this.loadBatches(bean);
    const selectedBatch =
      batches.find((batch) => batch.id === this.state.workflow?.context?.beanBatchId) ??
      latestBatch(batches);

    const shots = await this.loadShots(bean);
    const presets = readPresets(bean.id);
    const workflowMatches = this.workflowMatchesBean(bean);
    const draft =
      options.preferWorkflow && workflowMatches
        ? recipeFromWorkflow(this.state.workflow)
        : recipeFromShot(shots[0] ?? null);

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
      selectedBatchId: selectedBatch?.id ?? null,
      shots,
      presets,
      draft: normalizeDraft(draft, this.state.profiles, this.state.grinders),
      busy: false,
      status: `${shots.length} shots loaded`
    });

    if (options.apply && this.state.autoLoad) {
      await this.applyDraft();
    }
  }

  private async loadBatches(bean: Bean): Promise<BeanBatch[]> {
    if (this.state.demo) return this.state.batchesByBean[bean.id] ?? [];
    try {
      return await gateway.batches(bean.id);
    } catch (error) {
      console.warn('[Beanie] Could not load batches', error);
      return [];
    }
  }

  private async loadShots(bean: Bean): Promise<ShotRecord[]> {
    if (this.state.demo) return demoShotsForBean(bean);

    try {
      const page = await gateway.shots(shotFilterForBean(bean, null));
      const visible = page.items.slice(0, 14);
      return Promise.all(visible.map((shot) => this.loadFullShot(shot)));
    } catch (error) {
      console.warn('[Beanie] Could not load shots', error);
      return [];
    }
  }

  private async loadFullShot(shot: ShotSummary): Promise<ShotRecord> {
    try {
      return await gateway.shot(shot.id);
    } catch {
      return { ...shot, measurements: [] };
    }
  }

  private async applyDraft(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    const draft = normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders);
    const batch = this.selectedBatch();
    const update = buildWorkflowUpdate(bean, batch, draft, draft.profile);

    this.setState({ busy: true, status: 'Applying workflow' });
    if (this.state.demo) {
      this.setState({
        workflow: { ...this.state.workflow, ...update },
        draft,
        busy: false,
        status: 'Workflow applied in demo'
      });
      return;
    }

    try {
      const workflow = await gateway.updateWorkflow(update);
      this.setState({
        workflow,
        draft,
        busy: false,
        status: 'Workflow applied'
      });
    } catch (error) {
      console.error('[Beanie] Apply failed', error);
      this.setState({ busy: false, status: 'Apply failed' });
    }
  }

  private async savePreset(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    const preset: BeanPreset = {
      id: crypto.randomUUID(),
      name: presetName(this.state.draft),
      createdAt: new Date().toISOString(),
      recipe: { ...this.state.draft, sourceLabel: 'Saved preset' }
    };
    const presets = [preset, ...this.state.presets].slice(0, 8);
    writePresets(bean.id, presets);
    this.setState({ presets, status: 'Preset saved' });
  }

  private usePreset(id: string): void {
    const preset = this.state.presets.find((item) => item.id === id);
    if (!preset) return;
    this.setState({
      draft: normalizeDraft(preset.recipe, this.state.profiles, this.state.grinders),
      status: 'Preset loaded'
    });
  }

  private resetFromLastShot(): void {
    this.setState({
      draft: normalizeDraft(recipeFromShot(this.state.shots[0] ?? null), this.state.profiles, this.state.grinders),
      status: 'Reset to latest shot'
    });
  }

  private loadShotRecipe(shotId: string): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    this.setState({
      draft: normalizeDraft(recipeFromShot(shot), this.state.profiles, this.state.grinders),
      modal: null,
      detailShotId: null,
      status: 'Shot recipe loaded'
    });
  }

  private async machineAction(state: MachineState): Promise<void> {
    this.setState({ busy: true, status: `Sending ${state}` });
    if (this.state.demo) {
      this.setState({ busy: false, status: `Demo ${state}` });
      return;
    }
    try {
      await gateway.requestState(state);
      this.setState({ busy: false, status: `Sent ${state}` });
    } catch (error) {
      console.error('[Beanie] Machine action failed', error);
      this.setState({ busy: false, status: 'Machine command failed' });
    }
  }

  private connectMachineSocket(): void {
    if (this.state.demo) return;
    this.machineSocket?.close();
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/machine/snapshot`);
    this.machineSocket = ws;
    ws.onmessage = (event) => {
      try {
        this.state.machine = JSON.parse(event.data) as MachineSnapshot;
        this.scheduleRender();
      } catch (error) {
        console.warn('[Beanie] Bad machine frame', error);
      }
    };
    ws.onclose = () => {
      if (this.machineSocket !== ws) return;
      if (this.machineRetryTimer != null) window.clearTimeout(this.machineRetryTimer);
      this.machineRetryTimer = window.setTimeout(() => this.connectMachineSocket(), 2500);
    };
  }

  private connectScaleSocket(): void {
    if (this.state.demo) return;
    this.scaleSocket?.close();
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/scale/snapshot`);
    this.scaleSocket = ws;
    ws.onmessage = (event) => {
      try {
        this.state.scale = JSON.parse(event.data) as ScaleSnapshot;
        this.scheduleRender();
      } catch (error) {
        console.warn('[Beanie] Bad scale frame', error);
      }
    };
    ws.onclose = () => {
      if (this.scaleSocket !== ws) return;
      if (this.scaleRetryTimer != null) window.clearTimeout(this.scaleRetryTimer);
      this.scaleRetryTimer = window.setTimeout(() => this.connectScaleSocket(), 3000);
    };
  }

  private async onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    const field = el.dataset.field;

    switch (action) {
      case 'select-bean':
        if (id) await this.selectBean(id, { apply: true, preferWorkflow: false });
        break;
      case 'adjust':
        if (field) this.adjustField(field, Number(el.dataset.delta ?? '0'));
        break;
      case 'apply':
        await this.applyDraft();
        break;
      case 'save-preset':
        await this.savePreset();
        break;
      case 'use-preset':
        if (id) this.usePreset(id);
        break;
      case 'clear':
        this.setState({ draft: emptyRecipe(), status: 'Draft cleared' });
        break;
      case 'reset':
        this.resetFromLastShot();
        break;
      case 'edit-field':
        if (isEditField(field)) this.openEditDialog(field);
        break;
      case 'dialog-adjust':
        this.adjustDialogValue(Number(el.dataset.delta ?? '0'));
        break;
      case 'dialog-key':
        this.typeDialogKey(el.dataset.key ?? '');
        break;
      case 'dialog-backspace':
        this.backspaceDialogValue();
        break;
      case 'dialog-clear':
        this.setDialogValue('');
        break;
      case 'dialog-commit':
        this.commitEditDialog();
        break;
      case 'open-shot':
        if (id) this.setState({ modal: 'shot-detail', detailShotId: id });
        break;
      case 'load-shot':
        if (id) this.loadShotRecipe(id);
        break;
      case 'stop':
        await this.machineAction('idle');
        break;
      case 'sleep':
        await this.machineAction('sleeping');
        break;
      case 'refresh':
        await this.load();
        break;
      case 'open-settings':
        this.setState({ modal: 'settings' });
        break;
      case 'open-add-bean':
        this.setState({ modal: 'add-bean' });
        break;
      case 'close-modal':
        this.setState({ modal: null, editDialog: null, detailShotId: null });
        break;
      default:
        break;
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.dataset.action === 'search') {
      this.setState({ search: target.value });
    }
  }

  private async onChange(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const field = target.dataset.field;
    if (!field) return;

    if (field === 'autoLoad') {
      const enabled = (target as HTMLInputElement).checked;
      writeAutoLoad(enabled);
      this.setState({ autoLoad: enabled });
      return;
    }

    const draft = { ...this.state.draft };
    if (field === 'dose') draft.dose = parseNumberInput(target.value);
    if (field === 'yield') draft.yield = parseNumberInput(target.value);
    if (field === 'grinderSetting') draft.grinderSetting = target.value || null;
    if (field === 'profileId') {
      const record = this.state.profiles.find((profile) => profile.id === target.value);
      draft.profileId = record?.id ?? null;
      draft.profile = record?.profile ?? null;
      draft.profileTitle = record?.profile.title ?? null;
    }
    if (field === 'grinderId') {
      const grinder = this.state.grinders.find((item) => item.id === target.value);
      draft.grinderId = grinder?.id ?? null;
      draft.grinderModel = grinder?.model ?? null;
    }
    this.setState({ draft, status: 'Draft changed' });
  }

  private async onSubmit(event: Event): Promise<void> {
    const form = event.target as HTMLFormElement;
    if (form.dataset.form !== 'add-bean') return;
    event.preventDefault();
    const data = new FormData(form);
    const roaster = String(data.get('roaster') ?? '').trim();
    const name = String(data.get('name') ?? '').trim();
    if (!roaster || !name) return;

    this.setState({ busy: true, status: 'Adding bean' });
    if (this.state.demo) {
      const bean: Bean = { id: `demo-${Date.now()}`, roaster, name };
      this.setState({
        beans: [bean, ...this.state.beans],
        modal: null,
        busy: false,
        status: 'Bean added in demo'
      });
      await this.selectBean(bean.id, { apply: false, preferWorkflow: false });
      return;
    }

    try {
      const bean = await gateway.createBean({ roaster, name });
      this.setState({
        beans: [bean, ...this.state.beans],
        modal: null,
        busy: false,
        status: 'Bean added'
      });
      await this.selectBean(bean.id, { apply: false, preferWorkflow: false });
    } catch (error) {
      console.error('[Beanie] Add bean failed', error);
      this.setState({ busy: false, status: 'Add bean failed' });
    }
  }

  private adjustField(field: string, delta: number): void {
    const draft = { ...this.state.draft };
    if (field === 'dose') draft.dose = round((draft.dose ?? 0) + delta, 1);
    if (field === 'yield') draft.yield = round((draft.yield ?? 0) + delta, 1);
    if (field === 'grinderSetting') {
      const current = parseNumberInput(draft.grinderSetting ?? '0') ?? 0;
      draft.grinderSetting = round(current + delta, 2).toString();
    }
    this.setState({ draft, status: 'Draft changed' });
  }

  private openEditDialog(field: EditField): void {
    const draft = this.state.draft;
    const value =
      field === 'grinderSetting'
        ? draft.grinderSetting ?? ''
        : field === 'dose'
          ? draft.dose?.toString() ?? ''
          : draft.yield?.toString() ?? '';

    this.setState({
      modal: 'edit-number',
      editDialog: {
        field,
        title: field === 'grinderSetting' ? 'Grind' : capitalize(field),
        value,
        step: field === 'dose' ? 0.5 : field === 'yield' ? 1 : this.grinderStep()
      }
    });
  }

  private adjustDialogValue(delta: number): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    const current = parseNumberInput(dialog.value) ?? 0;
    const digits = dialog.field === 'grinderSetting' ? 2 : 1;
    this.setDialogValue(round(current + delta, digits).toString());
  }

  private typeDialogKey(key: string): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    if (key === '.' && dialog.value.includes('.')) return;
    if (key !== '.' && !/^\d$/.test(key)) return;

    const current = dialog.value;
    const next =
      current === '0' && key !== '.'
        ? key
        : current.length >= 7
          ? current
          : `${current}${key}`;
    this.setDialogValue(next);
  }

  private backspaceDialogValue(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setDialogValue(dialog.value.slice(0, -1));
  }

  private setDialogValue(value: string): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: { ...dialog, value } });
  }

  private commitEditDialog(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;

    const draft = { ...this.state.draft };
    if (dialog.field === 'dose') draft.dose = parseNumberInput(dialog.value);
    if (dialog.field === 'yield') draft.yield = parseNumberInput(dialog.value);
    if (dialog.field === 'grinderSetting') draft.grinderSetting = dialog.value.trim() || null;
    this.setState({ draft, modal: null, editDialog: null, status: 'Draft changed' });
  }

  private render(): void {
    const bean = this.selectedBean();
    this.root.innerHTML = `
      <div class="app-shell">
        ${this.renderTopbar()}
        <main class="workbench">
          ${this.renderBeanRail()}
          <section class="surface">
            ${this.renderHero(bean)}
            ${this.renderRecipeEditor(bean)}
            ${this.renderHistory()}
          </section>
        </main>
        ${this.renderModal()}
      </div>
    `;
    refreshIcons();
  }

  private renderTopbar(): string {
    const ready = this.state.machine?.state?.state ?? (this.state.loading ? 'loading' : 'idle');
    const machine = this.state.machine;
    const scale = this.state.scale;
    return `
      <header class="topbar">
        <div class="top-inline">
          <div class="top-stats" aria-label="Machine metrics">
            ${topStat('Machine', capitalize(ready))}
            ${topStat('Group', temp(machine?.groupTemperature))}
            ${topStat('Steam', temp(machine?.steamTemperature))}
            ${topStat('Scale', scale?.status === 'disconnected' ? 'offline' : `${formatNumber(scale?.weight, 1)} g`)}
          </div>
          <div class="top-icons" role="toolbar" aria-label="Skin actions">
            <button class="icon-tool" data-action="open-settings" aria-label="Settings" title="Settings">${icon('settings')}</button>
            <button class="icon-tool" data-action="sleep" aria-label="Sleep" title="Sleep">${icon('power')}</button>
          </div>
        </div>
      </header>
    `;
  }

  private renderBeanRail(): string {
    const query = this.state.search.trim().toLowerCase();
    const beans = this.state.beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query));
    return `
      <aside class="bean-rail panel">
        <div class="rail-head">
          <div>
            <span class="eyebrow">Beans</span>
            <h2>Pick a bag</h2>
          </div>
          <div class="rail-actions">
            <button class="icon-button" data-action="refresh" aria-label="Sync beans" title="Sync beans">${icon('refresh-cw')}</button>
            <button class="icon-button" data-action="open-add-bean" aria-label="Add bean" title="Add bean">${icon('plus')}</button>
          </div>
        </div>
        <label class="search">
          ${icon('search')}
          <input type="search" data-action="search" value="${escapeAttr(this.state.search)}" placeholder="Search beans" />
        </label>
        <div class="bean-list">
          ${beans.map((bean) => this.renderBeanButton(bean)).join('')}
        </div>
      </aside>
    `;
  }

  private renderBeanButton(bean: Bean): string {
    const active = bean.id === this.state.selectedBeanId;
    return `
      <button class="bean-row ${active ? 'active' : ''}" data-action="select-bean" data-id="${escapeAttr(bean.id)}">
        <small>${escapeHtml(bean.country ?? 'Recent bean')}</small>
        <b>${escapeHtml(bean.roaster)}</b>
        <strong>${escapeHtml(bean.name)}</strong>
      </button>
    `;
  }

  private renderHero(bean: Bean | null): string {
    const batch = this.selectedBatch();
    const draft = this.state.draft;
    return `
      <section class="hero panel">
        <div class="hero-main">
          <h1>${bean ? escapeHtml(beanLabel(bean)) : 'No bean selected'}</h1>
          <p>${escapeHtml(bean?.notes ?? bean?.processing ?? 'Select a bean to load the last dial-in.')}</p>
        </div>
        <div class="hero-side">
          <label class="switch">
            <input type="checkbox" data-field="autoLoad" ${this.state.autoLoad ? 'checked' : ''} />
            <span>Auto-load</span>
          </label>
          <span class="chip">${escapeHtml(draft.sourceLabel ?? 'No source')}</span>
          <span class="chip muted">${escapeHtml(batchSummary(batch))}</span>
        </div>
      </section>
    `;
  }

  private renderRecipeEditor(bean: Bean | null): string {
    const draft = this.state.draft;
    return `
      <section class="recipe-grid">
        ${this.controlNumber('Dose', 'dose', draft.dose, 0.5)}
        ${this.controlNumber('Yield', 'yield', draft.yield, 1)}
        ${this.controlGrind()}
        ${this.controlProfile()}
        <div class="quick-panel panel">
          <div class="quick-head">
            <span class="eyebrow">Bean presets</span>
            <button class="text-button" data-action="save-preset">${icon('save')}<span>Save</span></button>
          </div>
          <div class="preset-list">
            ${this.state.presets.length === 0 ? '<span class="empty">No presets</span>' : this.state.presets.map((preset) => `
              <button class="preset" data-action="use-preset" data-id="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</button>
            `).join('')}
          </div>
        </div>
        <div class="command-panel panel">
          <button class="command primary" data-action="apply" ${bean ? '' : 'disabled'}>${icon('sliders-horizontal')}<span>Apply</span></button>
          <button class="command" data-action="reset">${icon('rotate-ccw')}<span>Latest</span></button>
          <button class="command danger" data-action="clear">${icon('trash-2')}<span>Clear</span></button>
        </div>
      </section>
    `;
  }

  private controlNumber(label: string, field: EditField, value: number | null | undefined, step: number): string {
    return `
      <div class="control panel">
        <label>${escapeHtml(label)}</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="${field}" data-delta="${-step}" aria-label="Decrease ${escapeAttr(label)}">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="${field}">${escapeHtml(value == null ? '--' : value.toString())}</button>
          <button data-action="adjust" data-field="${field}" data-delta="${step}" aria-label="Increase ${escapeAttr(label)}">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private controlGrind(): string {
    const draft = this.state.draft;
    const step = this.grinderStep();
    return `
      <div class="control grind-control panel">
        <label>Grind</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="grinderSetting" data-delta="${-step}" aria-label="Decrease grind">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="grinderSetting">${escapeHtml(draft.grinderSetting ?? '--')}</button>
          <button data-action="adjust" data-field="grinderSetting" data-delta="${step}" aria-label="Increase grind">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private controlProfile(): string {
    const selectedId = this.profileIdForDraft();
    return `
      <div class="select-control panel">
        <label>Profile</label>
        <select data-field="profileId">
          <option value="">No profile</option>
          ${this.state.profiles.map((profile) => `
            <option value="${escapeAttr(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(profile.profile.title ?? profile.id)}</option>
          `).join('')}
        </select>
      </div>
    `;
  }

  private renderHistory(): string {
    return `
      <section class="history-panel panel">
        <div class="history-head">
          <div>
            <span class="eyebrow">History</span>
            <h2>Shots</h2>
          </div>
          <span class="chip">${this.state.shots.length} shots</span>
        </div>
        <div class="shot-list">
          ${this.state.shots.length === 0 ? '<p class="empty-history">No shots found for this bean.</p>' : this.state.shots.map((shot) => this.renderShotRow(shot)).join('')}
        </div>
      </section>
    `;
  }

  private renderShotRow(shot: ShotRecord): string {
    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const notes = shot.annotations?.espressoNotes ?? shot.shotNotes ?? '';
    const detail = [recipe.profileTitle ?? 'No profile', notes].filter(Boolean).join(' · ');
    return `
      <article class="shot-card">
        <button class="shot-load" data-action="open-shot" data-id="${escapeAttr(shot.id)}">
          <small>${Number.isNaN(date.valueOf()) ? escapeHtml(shot.timestamp) : escapeHtml(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small>
          <div class="shot-title-line">
            <b>${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}</b>
            ${enjoymentBadge(shot)}
          </div>
          <span>${escapeHtml(detail)}</span>
        </button>
        <div class="shot-dial">
          ${stat('Grind', recipe.grinderSetting ?? '--')}
        </div>
        ${renderShotGraph(shot)}
      </article>
    `;
  }

  private renderModal(): string {
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    if (this.state.modal === 'shot-detail') return this.renderShotDetail();
    if (this.state.modal === 'settings') {
      return `
        <div class="modal-backdrop">
          <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div class="modal-head">
              <h2 id="settings-title">Settings</h2>
              <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
            </div>
            <label class="settings-row">
              <span>Auto-load bean recipe</span>
              <input type="checkbox" data-field="autoLoad" ${this.state.autoLoad ? 'checked' : ''} />
            </label>
            <div class="modal-actions">
              <button type="button" class="command" data-action="refresh">${icon('refresh-cw')}<span>Sync</span></button>
              <button type="button" class="command primary" data-action="close-modal">Done</button>
            </div>
          </div>
        </div>
      `;
    }
    if (this.state.modal !== 'add-bean') return '';
    return `
      <div class="modal-backdrop">
        <form class="modal panel" data-form="add-bean" role="dialog" aria-modal="true" aria-labelledby="add-bean-title">
          <div class="modal-head">
            <h2 id="add-bean-title">Add Bean</h2>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
          <label>Roaster<input name="roaster" required autocomplete="off" /></label>
          <label>Coffee<input name="name" required autocomplete="off" /></label>
          <div class="modal-actions">
            <button type="button" class="command" data-action="close-modal">Cancel</button>
            <button class="command primary" type="submit">Add</button>
          </div>
        </form>
      </div>
    `;
  }

  private renderShotDetail(): string {
    const shot = this.state.shots.find((item) => item.id === this.state.detailShotId);
    if (!shot) return '';

    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const notes = shot.annotations?.espressoNotes ?? shot.shotNotes ?? '';
    const title = Number.isNaN(date.valueOf())
      ? shot.timestamp
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div class="modal-backdrop">
        <div class="shot-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="shot-detail-title">
          <div class="modal-head shot-detail-head">
            <div>
              <span class="eyebrow">Shot</span>
              <h2 id="shot-detail-title">${escapeHtml(title)}</h2>
            </div>
            <div class="shot-detail-head-actions">
              ${enjoymentBadge(shot, 'detail')}
              <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
            </div>
          </div>
          <div class="detail-summary">
            ${stat('Dose', formatGrams(recipe.dose))}
            ${stat('Yield', formatGrams(recipe.yield))}
            ${stat('Grind', recipe.grinderSetting ?? '--')}
          </div>
          <div class="detail-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</div>
          <div class="detail-chart">
            ${renderShotGraph(shot, { detailed: true })}
          </div>
          ${notes ? `<p class="detail-notes">${escapeHtml(notes)}</p>` : ''}
          <div class="detail-actions">
            <button type="button" class="command" data-action="close-modal">Close</button>
            <button type="button" class="command primary" data-action="load-shot" data-id="${escapeAttr(shot.id)}">${icon('sliders-horizontal')}<span>Load recipe</span></button>
          </div>
        </div>
      </div>
    `;
  }

  private renderEditDialog(): string {
    const dialog = this.state.editDialog;
    if (!dialog) return '';
    const selectedId = this.grinderIdForDraft();
    const step = dialog.step.toString();
    return `
      <div class="modal-backdrop">
        <div class="number-modal panel" role="dialog" aria-modal="true" aria-labelledby="edit-number-title">
          <div class="modal-head">
            <h2 id="edit-number-title">${escapeHtml(dialog.title)}</h2>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
          <div class="number-display">${escapeHtml(dialog.value || '--')}</div>
          ${dialog.field === 'grinderSetting' ? `
            <label class="dialog-select">
              <span>Grinder</span>
              <select data-field="grinderId">
                <option value="">No grinder</option>
                ${this.state.grinders.map((grinder) => `
                  <option value="${escapeAttr(grinder.id)}" ${grinder.id === selectedId ? 'selected' : ''}>${escapeHtml(grinder.model)}</option>
                `).join('')}
              </select>
            </label>
          ` : ''}
          <div class="dialog-nudges">
            <button data-action="dialog-adjust" data-delta="${-dialog.step}">-${escapeHtml(step)}</button>
            <button data-action="dialog-adjust" data-delta="${dialog.step}">+${escapeHtml(step)}</button>
          </div>
          <div class="keypad" aria-label="Numeric keypad">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((key) => `
              <button data-action="dialog-key" data-key="${key}">${key}</button>
            `).join('')}
            <button data-action="dialog-backspace">${icon('delete')}</button>
            <button class="muted-key" data-action="dialog-clear">Clear</button>
            <button class="commit-key" data-action="dialog-commit">Done</button>
          </div>
        </div>
      </div>
    `;
  }

  private selectedBean(): Bean | null {
    return this.state.beans.find((bean) => bean.id === this.state.selectedBeanId) ?? null;
  }

  private selectedBatch(): BeanBatch | null {
    const bean = this.selectedBean();
    if (!bean) return null;
    const batches = this.state.batchesByBean[bean.id] ?? [];
    return batches.find((batch) => batch.id === this.state.selectedBatchId) ?? latestBatch(batches);
  }

  private workflowMatchesBean(bean: Bean): boolean {
    const ctx = this.state.workflow?.context;
    return ctx?.coffeeName === bean.name && ctx?.coffeeRoaster === bean.roaster;
  }

  private profileIdForDraft(): string {
    const draft = this.state.draft;
    return (
      draft.profileId ??
      this.state.profiles.find((record) => record.profile.title === draft.profileTitle)?.id ??
      ''
    );
  }

  private grinderIdForDraft(): string {
    const draft = this.state.draft;
    return (
      draft.grinderId ??
      this.state.grinders.find((grinder) => grinder.model === draft.grinderModel)?.id ??
      ''
    );
  }

  private grinderStep(): number {
    const grinder = this.state.grinders.find((item) => item.id === this.grinderIdForDraft());
    return grinder?.settingSmallStep ?? 0.1;
  }

  private setState(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    this.render();
  }

  private scheduleRender(): void {
    if (this.renderTimer != null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 250);
  }
}

function topStat(label: string, value: string): string {
  return `<div class="top-stat"><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`;
}

function enjoymentBadge(shot: ShotRecord, size: 'row' | 'detail' = 'row'): string {
  const value = shot.annotations?.enjoyment;
  if (value == null) return '';
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `<span class="enjoyment-badge ${size === 'detail' ? 'large' : ''}" aria-label="Enjoyment ${escapeAttr(formatted)}"><span>Enjoy</span><strong>${escapeHtml(formatted)}</strong></span>`;
}

function batchSummary(batch: BeanBatch | null): string {
  if (!batch) return 'No batch';
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'No roast date';
  const weight = batch.weightRemaining != null ? ` / ${formatGrams(batch.weightRemaining)}` : '';
  return `${roastText}${weight}`;
}

function temp(value: number | null | undefined): string {
  return value == null ? '--' : `${value.toFixed(1)} C`;
}

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isEditField(value: string | undefined): value is EditField {
  return value === 'dose' || value === 'yield' || value === 'grinderSetting';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
