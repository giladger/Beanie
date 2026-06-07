import {
  liveShotPanelDecision,
  liveTelemetryFrameState,
  liveTelemetryIdleDecision
} from '../domain/liveTelemetry';
import type { MachineSnapshot, ScaleSnapshot } from '../api/types';

run('idle telemetry asks the shell to re-render on sleep transitions first', () => {
  const decision = liveTelemetryIdleDecision({
    previousService: null,
    currentService: 'steam',
    currentView: 'workbench',
    sleeping: true,
    asleep: false,
    scaleConnectionChanged: true
  });

  equal(decision.type, 'set-asleep');
  equal(decision.type === 'set-asleep' ? decision.asleep : false, true);
});

run('idle telemetry enters and refreshes machine progress pages for services', () => {
  equal(liveTelemetryIdleDecision({
    previousService: null,
    currentService: 'hotWater',
    currentView: 'workbench',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: false
  }).type, 'enter-service');

  equal(liveTelemetryIdleDecision({
    previousService: 'hotWater',
    currentService: 'hotWater',
    currentView: 'machine',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: false
  }).type, 'refresh-service');
});

run('idle telemetry leaves machine progress page when a service ends', () => {
  equal(liveTelemetryIdleDecision({
    previousService: 'flush',
    currentService: null,
    currentView: 'machine',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: false
  }).type, 'leave-service');
});

run('idle telemetry checks water alert before scale-only machine refreshes', () => {
  equal(liveTelemetryIdleDecision({
    previousService: null,
    currentService: null,
    currentView: 'machine',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: true
  }).type, 'check-water-alert');

  equal(liveTelemetryIdleDecision({
    previousService: null,
    currentService: null,
    currentView: 'machine',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: true,
    waterAlertChanged: true
  }).type, 'water-alert-changed');

  equal(liveTelemetryIdleDecision({
    previousService: null,
    currentService: null,
    currentView: 'machine',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: true,
    waterAlertChanged: false
  }).type, 'refresh-scale-connection');
});

run('idle telemetry falls back to topbar patching for ordinary idle frames', () => {
  equal(liveTelemetryIdleDecision({
    previousService: null,
    currentService: null,
    currentView: 'workbench',
    sleeping: false,
    asleep: false,
    scaleConnectionChanged: false,
    waterAlertChanged: false
  }).type, 'patch-topbar');
});

run('telemetry frame state merges partial socket frames and tracks service/scale transitions', () => {
  const currentMachine = machine('idle');
  const currentScale = scale('disconnected');
  const nextMachine = machine('hotWater');
  const state = liveTelemetryFrameState({
    currentMachine,
    currentScale,
    machineFrame: nextMachine,
    scaleFrame: null,
    view: 'workbench',
    asleep: false,
    tMs: 1_000
  });

  equal(state.previousMachineState, 'idle');
  equal(state.previousService, null);
  equal(state.currentMachine, nextMachine);
  equal(state.currentScale, currentScale);
  equal(state.currentService, 'hotWater');
  equal(state.scaleConnectionChanged, false);
  equal(state.idleDecisionInput.currentService, 'hotWater');

  const scaleOnly = liveTelemetryFrameState({
    currentMachine: nextMachine,
    currentScale,
    machineFrame: null,
    scaleFrame: scale('connected'),
    view: 'machine',
    asleep: false,
    tMs: 2_000
  });

  equal(scaleOnly.currentMachine, nextMachine);
  equal(scaleOnly.scaleConnectionChanged, true);
  equal(scaleOnly.freshScaleConnected, true);
  equal(scaleOnly.idleDecisionInput.scaleConnectionChanged, true);
});

run('live shot panel decision maps active transitions', () => {
  equal(liveShotPanelDecision(false, true), 'started');
  equal(liveShotPanelDecision(true, false), 'ended');
  equal(liveShotPanelDecision(true, true), 'active');
  equal(liveShotPanelDecision(false, false), 'idle');
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

function machine(state: MachineSnapshot['state']['state']): MachineSnapshot {
  return {
    timestamp: '2026-06-07T00:00:00.000Z',
    state: { state },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 90,
    groupTemperature: 92,
    targetMixTemperature: 90,
    targetGroupTemperature: 92,
    profileFrame: 0,
    steamTemperature: 120
  };
}

function scale(status: ScaleSnapshot['status']): ScaleSnapshot {
  return {
    timestamp: '2026-06-07T00:00:00.000Z',
    weight: 0,
    weightFlow: 0,
    status
  };
}
