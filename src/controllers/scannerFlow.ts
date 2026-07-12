import type { ClickActionHandler } from './actionContract';
import type { BeanWorkflowController } from './beanWorkflowController';
import type {
  LabelScannerStatePatch,
  ScannerFlowState,
  ScannerFlowStatePatch
} from './scannerFlowContract';
import { gateway } from '../api/gateway';
import { beanieCache } from '../domain/cache';
import {
  GeminiError,
  enrichLabel,
  isGeminiKeyError,
  scanLabel,
  verifyGeminiKey
} from '../api/gemini';
import { isDecentAppWebView } from '../appShell';
import { renderQrSvg } from '../components/qr';
import { beanLabel } from '../domain/beanWorkflow';
import { type CapturedImage } from '../domain/labelImage';
import type { ImageTranscoder } from '../platform/imageTranscoder';
import {
  buildLabelScanPrompt,
  canonicalizeDraft,
  countRoasterBeans,
  findExistingBean,
  labelScanToDraft,
  lowConfidenceFields,
  mergeEnrichment,
  type LabelScanDraft
} from '../domain/labelScan';
import { buildHandoffUrl } from '../domain/labelScanHandoff';
import {
  readGeminiApiKey,
  readScanOnThisDevice,
  writeGeminiApiKey,
  writeScanOnThisDevice
} from '../domain/storage';
import { demoLabelEnrich, demoLabelScan } from '../mock/demo';
import { batchFieldsFromForm, beanFieldsFromForm } from '../domain/beanForm';
import type { LabelScan } from '../domain/labelScan';

const MAX_SCANNER_IMAGES = 4;

// The label scanner: photo capture/handoff, Gemini extraction + enrichment,
// the review form, and saving the result as a bean + batch. Extracted
// vertically from app.ts; ScannerFlowHost below is the full coupling surface
// back into the app.
export interface ScannerFlowHost {
  state(): ScannerFlowState;
  setState(next: ScannerFlowStatePatch): void;
  selectBean(
    beanId: string,
    options: { apply: boolean; preferWorkflow: boolean; preferredBatchId?: string | null }
  ): Promise<void>;
  loadSettings(): Promise<void>;
}

export class ScannerFlow {
  constructor(
    private readonly host: ScannerFlowHost,
    private readonly beanWorkflow: BeanWorkflowController,
    private readonly imageTranscoder: ImageTranscoder
  ) {}

  scannerClickActions(): Record<string, ClickActionHandler> {
    return {
      'open-label-scanner': async () => {
        await this.openLabelScanner();
      },
      'scanner-setup-here': () => {
        // Remember the choice so this device scans on-device next time without
        // showing the hand-off screen (it only takes effect once a key exists).
        writeScanOnThisDevice(true);
        this.setScanner({ handoff: false });
      },
      'scanner-use-phone': () => {
        // Going back to the phone hand-off clears the per-device preference.
        writeScanOnThisDevice(false);
        this.setScanner({ handoff: true });
      },
      'scanner-verify-key': async ({ el }) => {
        const input = el.closest('form')?.querySelector<HTMLInputElement>('input[name="apiKey"]');
        const key = input?.value.trim() ?? '';
        const request = this.beginScannerRequest();
        this.setScanner({ keyDraft: key, verifying: true, verifyMessage: null });
        try {
          const result = await verifyGeminiKey(key, { signal: request.signal });
          if (!this.scannerRequestAlive(request)) return;
          this.setScanner({
            verifying: false,
            verifyMessage: { tone: result.ok ? 'good' : 'warn', text: result.message }
          });
        } finally {
          if (this.scannerRequest === request.controller) this.scannerRequest = null;
        }
      },
      'scanner-change-key': () => {
        this.setScanner({ step: 'onboard', keyDraft: readGeminiApiKey() ?? '', verifyMessage: null });
      },
      'scanner-remove-photo': ({ index }) => {
        const scanner = this.host.state().scanner;
        const removeAt = Number(index);
        if (scanner && Number.isInteger(removeAt)) {
          this.setScanner({ images: scanner.images.filter((_, position) => position !== removeAt) });
        }
      },
      'scanner-extract': async () => {
        await this.runScannerExtraction();
      },
      'scanner-rescan': () => {
        // Also the Cancel button while extracting — abort whatever is in flight.
        this.cancelScannerWork();
        this.setScanner({ step: 'capture', scan: null, draft: null, error: null, saving: false, webFields: [], enriching: false });
      },
      'scanner-enrich': async () => {
        await this.runScannerEnrich();
      },
    };
  }

  setScanner(patch: LabelScannerStatePatch): void {
    const scanner = this.host.state().scanner;
    if (!scanner) return;
    this.host.setState({ scanner: { ...scanner, ...patch } });
  }

  /**
   * Scanner requests are tied to a session id so a response that arrives after
   * the modal was closed (or reopened) can't write into the new session, and an
   * AbortController so closing/cancelling actually stops the network call.
   */
  private scannerSession = 0;
  private scannerRequestSeq = 0;
  private scannerRequest: AbortController | null = null;

  /** Abort in-flight scanner network work and invalidate its session. */
  cancelScannerWork(): void {
    this.scannerSession++;
    this.scannerRequestSeq++;
    this.scannerRequest?.abort();
    this.scannerRequest = null;
  }

  /** Fresh signal for one scanner request, bound to the current session. */
  private beginScannerRequest(): ScannerRequest {
    this.scannerRequest?.abort();
    this.scannerRequest = new AbortController();
    this.scannerRequestSeq += 1;
    return {
      signal: this.scannerRequest.signal,
      session: this.scannerSession,
      request: this.scannerRequestSeq,
      controller: this.scannerRequest
    };
  }

  private scannerSessionCurrent(session: number): boolean {
    return session === this.scannerSession;
  }

  private scannerSessionAlive(session: number): boolean {
    return session === this.scannerSession && this.host.state().scanner != null;
  }

  private scannerRequestAlive(request: ScannerRequest): boolean {
    return (
      this.scannerSessionAlive(request.session) &&
      request.request === this.scannerRequestSeq &&
      request.controller === this.scannerRequest &&
      !request.signal.aborted
    );
  }

  /**
   * Open the scanner. The Decent tablet (whose webview user agent is exactly
   * "Decent") can't take photos well, so it hands off to a phone via QR. A phone
   * or normal browser — including the one that scanned the QR — runs the flow
   * on-device. Demo and the QR-arrival both go straight to the on-device flow.
   */
  async openLabelScanner(options: { fromHandoff?: boolean } = {}): Promise<void> {
    this.cancelScannerWork();
    const session = this.scannerSession;
    // Wait for startup so the one-time legacy gateway-key migration has run.
    await this.host.loadSettings();
    if (!this.scannerSessionCurrent(session)) return;
    const hasKey = readGeminiApiKey() != null;
    // A tablet that has chosen "Set up on this device" (and has a key) skips the
    // hand-off entirely and scans on-device from then on.
    const scanHere = hasKey && readScanOnThisDevice();
    const handoff = isDecentAppWebView() && options.fromHandoff !== true && !this.host.state().demo && !scanHere;
    // Build the QR from the gateway's LAN IP (the tablet webview is on localhost).
    const lanAddress = handoff ? await gateway.lanAddress() : null;
    if (!this.scannerSessionCurrent(session)) return;
    const handoffUrl = handoff ? buildHandoffUrl(location.href, lanAddress) : null;
    this.host.setState({
      modal: 'label-scanner',
      scanner: {
        step: handoff ? 'onboard' : this.host.state().demo || hasKey ? 'capture' : 'onboard',
        handoff,
        qrSvg: handoffUrl ? renderQrSvg(handoffUrl) : null,
        qrUrl: handoffUrl,
        keyDraft: '',
        verifying: false,
        verifyMessage: null,
        images: [],
        scan: null,
        draft: null,
        lowConfidence: [],
        webFields: [],
        enriching: false,
        existingBeanId: null,
        existingBeanLabel: null,
        roasterBeanCount: 0,
        saving: false,
        error: null
      }
    });
  }

  async addScannerPhotos(files: File[]): Promise<void> {
    const scannerAtStart = this.host.state().scanner;
    if (!scannerAtStart) return;
    const session = this.scannerSession;
    const capacity = Math.max(0, MAX_SCANNER_IMAGES - scannerAtStart.images.length);
    const selected = files.slice(0, capacity);
    if (selected.length === 0) {
      this.host.setState({ status: `Scanner keeps up to ${MAX_SCANNER_IMAGES} photos` });
      return;
    }
    // One shared native-resource host keeps decode/canvas concurrency and the
    // retained batch pixel budget bounded. Per-file failures stay isolated.
    const transcoded = await this.imageTranscoder.transcodeBatch(selected, {
      maxEdge: 2_000,
      maxPixels: 4_000_000,
      maxTotalPixels: 16_000_000,
      concurrency: 1,
      mimeType: 'image/jpeg',
      quality: 0.85
    });
    const results: PromiseSettledResult<CapturedImage>[] = transcoded.map((result) =>
      result.status === 'rejected'
        ? result
        : {
            status: 'fulfilled',
            value: {
              mime: result.value.mime,
              base64: result.value.dataUrl.slice(result.value.dataUrl.indexOf(',') + 1),
              dataUrl: result.value.dataUrl
            }
          }
    );
    if (!this.scannerSessionAlive(session)) return;
    const added: CapturedImage[] = results
      .filter((result): result is PromiseFulfilledResult<CapturedImage> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = results.length - added.length;
    const scanner = this.host.state().scanner;
    if (added.length > 0 && scanner) this.setScanner({ images: [...scanner.images, ...added] });
    if (failed > 0) {
      console.error(
        '[Beanie] Could not prepare photo',
        results.find((result) => result.status === 'rejected')
      );
      this.host.setState({ status: failed === 1 ? 'Could not read one photo' : `Could not read ${failed} photos` });
    } else if (selected.length < files.length) {
      this.host.setState({ status: `Scanner keeps up to ${MAX_SCANNER_IMAGES} photos; extras skipped` });
    }
  }

  private async runScannerExtraction(): Promise<void> {
    const scanner = this.host.state().scanner;
    if (!scanner) return;
    if (!this.host.state().demo && readGeminiApiKey() == null) {
      this.setScanner({
        step: 'onboard',
        handoff: false,
        verifyMessage: { tone: 'warn', text: 'Add your Gemini API key first.' }
      });
      return;
    }
    const request = this.beginScannerRequest();
    const { signal } = request;
    this.setScanner({ step: 'extracting', error: null });
    try {
      const scan: LabelScan = this.host.state().demo
        ? demoLabelScan()
        : await scanLabel(
            scanner.images.map((image) => ({ mime: image.mime, base64: image.base64 })),
            readGeminiApiKey() ?? '',
            { signal, prompt: buildLabelScanPrompt(this.host.state().beans) }
          );
      if (!this.scannerRequestAlive(request)) return;
      const draft = canonicalizeDraft(labelScanToDraft(scan), this.host.state().beans);
      const existing = findExistingBean(this.host.state().beans, draft.roaster, draft.name);
      this.setScanner({
        step: 'review',
        scan,
        draft,
        lowConfidence: [...lowConfidenceFields(scan)],
        webFields: [],
        enriching: false,
        existingBeanId: existing?.id ?? null,
        existingBeanLabel: existing ? beanLabel(existing) : null,
        roasterBeanCount: countRoasterBeans(this.host.state().beans, draft.roaster)
      });
      // Look up the roaster's site in the background — the review form is
      // already editable while it searches.
      void this.runScannerEnrich({ auto: true });
    } catch (error) {
      if (signal.aborted || !this.scannerRequestAlive(request)) return;
      console.error('[Beanie] Label scan failed', error);
      if (isGeminiKeyError(error)) {
        // The stored key went bad — back to onboarding instead of a dead retry loop.
        this.setScanner({
          step: 'onboard',
          handoff: false,
          keyDraft: readGeminiApiKey() ?? '',
          verifyMessage: { tone: 'warn', text: 'Gemini rejected your API key — check it and save again.' }
        });
        return;
      }
      const message = error instanceof GeminiError ? error.message : 'Could not read the label — try again.';
      this.setScanner({ step: 'error', error: message });
    } finally {
      if (this.scannerRequest === request.controller) this.scannerRequest = null;
    }
  }

  /** The review form's live values, falling back to the stored draft. */
  private readScannerReviewDraft(): LabelScanDraft | null {
    const form = document.querySelector<HTMLFormElement>('form[data-form="scanner-review"]');
    if (!form) return this.host.state().scanner?.draft ?? null;
    const data = new FormData(form);
    const get = (name: string): string => String(data.get(name) ?? '');
    return {
      roaster: get('roaster'),
      name: get('name'),
      country: get('country'),
      region: get('region'),
      processing: get('processing'),
      notes: get('notes'),
      roastDate: get('roastDate'),
      roastLevel: get('roastLevel'),
      weight: get('weight')
    };
  }

  /**
   * Look up the roaster's site and fold extra detail into the draft. Runs
   * automatically when the review opens (auto: failures stay quiet — the
   * button is still there to retry) and from the enrich button (manual:
   * failures surface in the status line). The merge reads the live form so
   * edits made while it searches are never clobbered.
   */
  private async runScannerEnrich(options: { auto?: boolean } = {}): Promise<void> {
    const scanner = this.host.state().scanner;
    if (!scanner || scanner.enriching || scanner.step !== 'review') return;
    const base = this.readScannerReviewDraft();
    if (!base) return;
    if (!base.roaster.trim() || !base.name.trim()) {
      if (!options.auto) this.host.setState({ status: 'Add a roaster and bean name to enrich.' });
      return;
    }

    const request = this.beginScannerRequest();
    const { signal } = request;
    this.setScanner({ enriching: true });
    try {
      const enrichment = this.host.state().demo
        ? demoLabelEnrich()
        : await enrichLabel(
            { roaster: base.roaster, name: base.name, country: base.country },
            readGeminiApiKey() ?? '',
            { signal }
          );
      if (!this.scannerRequestAlive(request) || this.host.state().scanner?.step !== 'review') return;
      const current = this.readScannerReviewDraft() ?? base;
      const merged = mergeEnrichment(current, enrichment);
      this.withScannerFocusKept(() =>
        this.setScanner({
          enriching: false,
          draft: merged.draft,
          webFields: [...new Set([...(this.host.state().scanner?.webFields ?? []), ...merged.webFields])]
        })
      );
      if (!options.auto && merged.webFields.length === 0) this.host.setState({ status: 'No extra details found.' });
    } catch (error) {
      if (signal.aborted || !this.scannerRequestAlive(request)) return;
      console.error('[Beanie] Enrich failed', error);
      this.setScanner({ enriching: false });
      if (!options.auto) {
        const message = error instanceof GeminiError ? error.message : 'Could not reach the roaster — try again.';
        this.host.setState({ status: message });
      }
    } finally {
      if (this.scannerRequest === request.controller) this.scannerRequest = null;
    }
  }

  /**
   * Re-rendering replaces the review form's inputs; when a background enrich
   * lands mid-typing, put the caret back where it was.
   */
  private withScannerFocusKept(render: () => void): void {
    const active = document.activeElement;
    const focused =
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.closest('form[data-form="scanner-review"]')
        ? { name: active.name, start: active.selectionStart, end: active.selectionEnd }
        : null;
    render();
    if (!focused) return;
    const next = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `form[data-form="scanner-review"] [name="${focused.name}"]`
    );
    if (!next) return;
    next.focus();
    try {
      if (focused.start != null && focused.end != null) next.setSelectionRange(focused.start, focused.end);
    } catch {
      // date/number inputs don't support selection ranges
    }
  }

  saveScannerKey(form: HTMLFormElement): void {
    const key = String(new FormData(form).get('apiKey') ?? '').trim();
    if (!key) {
      this.setScanner({ verifyMessage: { tone: 'warn', text: 'Enter your API key first.' } });
      return;
    }
    // Credentials are device-local and never enter the synced settings store.
    writeGeminiApiKey(key);
    this.setScanner({ step: 'capture', keyDraft: '', verifyMessage: null });
  }

  async submitScannerReview(form: HTMLFormElement): Promise<void> {
    const scanner = this.host.state().scanner;
    if (!scanner || scanner.saving) return;
    const data = new FormData(form);
    const beanFields = beanFieldsFromForm(data);
    if (!beanFields.roaster || !beanFields.name) {
      this.host.setState({ status: 'Add a roaster and a bean name.' });
      return;
    }

    // Stop a still-running background enrich from re-rendering the form mid-save.
    this.cancelScannerWork();
    const session = this.scannerSession;
    this.setScanner({ saving: true, error: null, enriching: false });

    const existing =
      (scanner.existingBeanId ? this.host.state().beans.find((bean) => bean.id === scanner.existingBeanId) : null) ??
      findExistingBean(this.host.state().beans, beanFields.roaster, beanFields.name);

    let beanId: string;
    let beans = this.host.state().beans;
    let batchesByBean = this.host.state().batchesByBean;

    if (existing) {
      beanId = existing.id;
    } else {
      const saved = await this.beanWorkflow.saveBean(
        { beans, batchesByBean, editingId: null, fields: beanFields, demo: this.host.state().demo, nowMs: Date.now() },
        {
          createBean: (input) => gateway.createBean(input),
          updateBean: (id, input) => gateway.updateBean(id, input),
          putBeans: (next) => beanieCache.putBeans(next),
          putBeanBatches: (id, batches) => beanieCache.putBeanBatches(id, batches)
        }
      );
      if (!this.scannerSessionAlive(session)) return;
      if (saved.type === 'failed') {
        console.error('[Beanie] Scanner save bean failed', saved.error);
        this.setScanner({ saving: false, step: 'error', error: saved.status });
        return;
      }
      beanId = saved.bean.id;
      beans = saved.beans;
      batchesByBean = saved.batchesByBean;
    }

    const bean = existing ?? beans.find((item) => item.id === beanId);
    if (!bean) {
      this.setScanner({ saving: false, step: 'error', error: 'Could not save the bean.' });
      return;
    }

    const batchInput = batchFieldsFromForm(data, beanId);
    batchInput.weightRemaining = batchInput.weight;

    const created = await this.beanWorkflow.createBatch(
      {
        bean,
        batchesByBean,
        selectedBeanId: this.host.state().selectedBeanId,
        selectedBatchId: this.host.state().selectedBatchId,
        batchInput,
        demo: this.host.state().demo,
        nowMs: Date.now()
      },
      {
        createBatch: (id, input) => gateway.createBatch(id, input),
        putBeanBatches: (id, batches) => beanieCache.putBeanBatches(id, batches)
      }
    );
    if (!this.scannerSessionAlive(session)) return;

    if (created.type === 'failed') {
      console.error('[Beanie] Scanner add batch failed', created.error);
      this.host.setState({ beans, batchesByBean });
      this.setScanner({ saving: false, step: 'error', error: created.status });
      return;
    }

    this.cancelScannerWork();
    this.host.setState({
      beans,
      batchesByBean: created.batchesByBean,
      selectedBatchId: created.batch.id,
      modal: null,
      scanner: null,
      status: existing ? 'Added a bag from the label' : 'Added a bean from the label'
    });
    await this.host.selectBean(beanId, { apply: false, preferWorkflow: false });
  }
}

interface ScannerRequest {
  signal: AbortSignal;
  session: number;
  request: number;
  controller: AbortController;
}
