import type {
  Bean,
  BeanBatch,
  RecipeDraft,
  ShotMeasurement,
  ShotRecord,
  Workflow
} from '../api/types';
import type { LiveShotState } from './liveShot';
import { buildWorkflowUpdate } from './beanWorkflow';
import { freshnessSnapshotForShot } from './beanFreshness';

// Builds a ShotRecord out of an in-flight live shot, so the history list can
// show the just-pulled shot immediately while the gateway is still saving it.

export function optimisticShotFromLive(
  bean: Bean,
  batch: BeanBatch | null,
  workflow: Workflow | null,
  draft: RecipeDraft,
  liveState: LiveShotState
): ShotRecord | null {
  if (liveState.startMs == null) return null;
  const shotWorkflow = buildWorkflowUpdate(bean, batch, draft, draft.profile, workflow);
  return {
    id: `pending-live-${liveState.startMs}`,
    timestamp: new Date(liveState.startMs).toISOString(),
    workflow: shotWorkflow,
    annotations: {
      actualDoseWeight: draft.dose ?? shotWorkflow.context?.targetDoseWeight ?? null,
      actualYield: liveState.latest.weight ?? draft.yield ?? shotWorkflow.context?.targetYield ?? null
    },
    metadata: shotMetadataWithFreshness({ pendingLiveShot: true }, null, batch, new Date(liveState.startMs).toISOString()),
    measurements: measurementsFromLiveShot(liveState)
  };
}

export function shotMetadataWithFreshness(
  existing: Record<string, unknown> | null | undefined,
  extras: Record<string, unknown> | null | undefined,
  batch: BeanBatch | null | undefined,
  timestamp: string
): Record<string, unknown> | null {
  const metadata = {
    ...(existing ?? {}),
    ...(extras ?? {})
  };
  const freshness = freshnessSnapshotForShot(batch, timestamp);
  if (freshness) metadata.freshness = freshness;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function measurementsFromLiveShot(liveState: LiveShotState): ShotMeasurement[] {
  if (liveState.startMs == null) return [];
  const byMs = new Map<number, { machine: Record<string, unknown>; scale: Record<string, unknown> }>();
  const frameFor = (t: number) => {
    const tMs = liveState.startMs! + Math.round(t * 1000);
    let frame = byMs.get(tMs);
    if (!frame) {
      const timestamp = new Date(tMs).toISOString();
      frame = {
        machine: { timestamp, state: { state: 'espresso', substate: 'pouring' } },
        scale: { timestamp }
      };
      byMs.set(tMs, frame);
    }
    return frame;
  };

  for (const series of liveState.series) {
    for (const point of series.points) {
      const frame = frameFor(point.t);
      if (series.key === 'pressure') frame.machine.pressure = point.value;
      if (series.key === 'flow') frame.machine.flow = point.value;
      if (series.key === 'targetPressure') frame.machine.targetPressure = point.value;
      if (series.key === 'targetFlow') frame.machine.targetFlow = point.value;
      if (series.key === 'groupTemperature') frame.machine.groupTemperature = point.value * 10;
      if (series.key === 'targetTemperature') frame.machine.targetGroupTemperature = point.value * 10;
      if (series.key === 'weightFlow') frame.scale.weightFlow = point.value;
    }
  }

  return [...byMs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, frame]) => ({ machine: frame.machine, scale: frame.scale }) as ShotMeasurement);
}
