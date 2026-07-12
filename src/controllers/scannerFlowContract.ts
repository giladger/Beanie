import type { Bean, BeanBatch } from '../api/types';
import type { CapturedImage } from '../domain/labelImage';
import type {
  LabelScan,
  LabelScanDraft,
  LabelScanDraftField
} from '../domain/labelScan';

export type LabelScannerStep = 'onboard' | 'capture' | 'extracting' | 'review' | 'error';

/** Complete scanner session projection rendered by the application shell. */
export interface LabelScannerState {
  step: LabelScannerStep;
  handoff: boolean;
  qrSvg: string | null;
  qrUrl: string | null;
  keyDraft: string;
  verifying: boolean;
  verifyMessage: { tone: 'good' | 'warn'; text: string } | null;
  images: CapturedImage[];
  scan: LabelScan | null;
  draft: LabelScanDraft | null;
  lowConfidence: LabelScanDraftField[];
  webFields: LabelScanDraftField[];
  enriching: boolean;
  existingBeanId: string | null;
  existingBeanLabel: string | null;
  /** Beans already in the library from the scanned roaster. */
  roasterBeanCount: number;
  saving: boolean;
  error: string | null;
}

export type LabelScannerStatePatch = Partial<LabelScannerState>;

/** The complete application-state surface ScannerFlow is allowed to read. */
export interface ScannerFlowState {
  demo: boolean;
  scanner: LabelScannerState | null;
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
}

/**
 * The exact application projection ScannerFlow may publish. Optional fields
 * support targeted patches while preventing unrelated AppState ownership from
 * leaking back into the feature.
 */
export interface ScannerFlowStatePatch {
  scanner?: LabelScannerState | null;
  modal?: 'label-scanner' | null;
  status?: string;
  beans?: Bean[];
  batchesByBean?: Record<string, BeanBatch[]>;
  selectedBatchId?: string | null;
}
