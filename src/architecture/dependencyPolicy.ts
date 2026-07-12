/**
 * Executable dependency direction for production modules.
 *
 * Rows are importers; values are the layers they may import. Cross-layer debt
 * is admitted only through exact file-to-file entries below, so a legacy edge
 * cannot become permission for an entire directory.
 */

export const ARCHITECTURE_LAYERS = [
  'architecture',
  'api',
  'platform',
  'runtime',
  'telemetry',
  'domain',
  'data',
  'components',
  'render',
  'controllers',
  'views',
  'mock',
  'composition'
] as const;

export type ArchitectureLayer = (typeof ARCHITECTURE_LAYERS)[number];

export const ALLOWED_LAYER_DEPENDENCIES: Readonly<
  Record<ArchitectureLayer, readonly ArchitectureLayer[]>
> = {
  architecture: ['architecture'],
  api: ['api'],
  platform: ['platform'],
  runtime: ['runtime', 'platform'],
  telemetry: ['telemetry', 'api', 'runtime'],
  domain: ['domain', 'api'],
  data: ['data', 'domain', 'api', 'runtime', 'platform'],
  components: ['components', 'domain', 'api', 'platform'],
  render: ['render', 'components', 'domain', 'runtime', 'platform'],
  controllers: [
    'controllers',
    'domain',
    'data',
    'api',
    'telemetry',
    'runtime',
    'platform',
    'mock'
  ],
  views: ['views', 'components', 'domain', 'api'],
  mock: ['mock', 'domain', 'api'],
  // app.ts/appShell.ts/main.ts are the composition shell and may wire layers.
  composition: [...ARCHITECTURE_LAYERS]
};

export interface DependencyDebt {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly migration: string;
}

/**
 * Exact current inversions. The guard also fails when one becomes stale, so
 * removing an import requires removing its debt entry in the same change.
 */
export const DEPENDENCY_DEBT: readonly DependencyDebt[] = [
  {
    from: 'api/gemini.ts',
    to: 'domain/labelScan.ts',
    reason: 'The Gemini transport owns prompt construction and returns a domain scan model.',
    migration: 'Define a label-scanner port in domain and move the Gemini adapter out of the API contract layer.'
  },
  {
    from: 'controllers/profileEditorFlow.ts',
    to: 'appShell.ts',
    reason: 'The profile editor reaches into shell policy for its default exit value.',
    migration: 'Inject the default-exit policy or move it into a domain profile policy module.'
  },
  {
    from: 'controllers/derekFlow.ts',
    to: 'appShell.ts',
    reason: 'Controller formatting still reaches into shell helpers.',
    migration: 'Move numeric formatting into a domain/presentation formatter.'
  },
  {
    from: 'controllers/scannerFlow.ts',
    to: 'appShell.ts',
    reason: 'Device-environment detection is imported from the shell.',
    migration: 'Inject a platform capability port into ScannerFlow.'
  },
  {
    from: 'controllers/derekFlow.ts',
    to: 'render/derekStreamIsland.ts',
    reason: 'The flow imports an island-owned view-model type.',
    migration: 'Move DerekStreamViewModel to a presentation contract module.'
  },
  {
    from: 'controllers/derekFlow.ts',
    to: 'views/derekView.ts',
    reason: 'Controller currently builds view-specific phase/preview output.',
    migration: 'Move presentation projection behind a presenter consumed by both flow and view.'
  },
  {
    from: 'controllers/profileEditorFlow.ts',
    to: 'components/InputDialog.ts',
    reason: 'The UI coordinator constructs a component-specific dialog model.',
    migration: 'Move the dialog model contract out of the component module.'
  },
  {
    from: 'controllers/profileEditorFlow.ts',
    to: 'components/profileEditor.ts',
    reason: 'Profile edit state and reducers are colocated with rendering.',
    migration: 'Split editor state/reducers into domain and keep markup in components.'
  },
  {
    from: 'controllers/scannerFlow.ts',
    to: 'components/qr.ts',
    reason: 'The controller generates rendered SVG instead of publishing QR data.',
    migration: 'Publish the handoff URL and let the view/component render the QR.'
  },
  {
    from: 'domain/labelImage.ts',
    to: 'platform/imageTranscoder.ts',
    reason: 'A compatibility facade remains under domain for existing callers.',
    migration: 'Move CapturedImage/fileToScaledImage callers to the injected platform port.'
  },
  {
    from: 'domain/profileTweaks.ts',
    to: 'components/profileEditor.ts',
    reason: 'Domain tweak logic imports editor reducers colocated with rendering.',
    migration: 'Extract profile editor state/reducers to domain/profileEditorModel.ts.'
  },
  {
    from: 'views/cleaningWizardView.ts',
    to: 'controllers/cleaningWizardController.ts',
    reason: 'The view imports controller state helpers directly.',
    migration: 'Introduce a cleaning-wizard view model projected before rendering.'
  },
  {
    from: 'views/derekView.ts',
    to: 'controllers/derekController.ts',
    reason: 'The view derives presentation from controller state directly.',
    migration: 'Project a DerekViewModel outside the string renderer.'
  },
  {
    from: 'views/workbenchView.ts',
    to: 'render/topbarPresentation.ts',
    reason: 'The shell view imports an imperative-island presentation contract.',
    migration: 'Move TopbarViewModel to a neutral presentation contracts module.'
  }
];
