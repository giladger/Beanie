export interface FirmwareUpload {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** DOM-free settings intent shared by the control reader and flow owner. */
export type MachineSettingsChange =
  | { readonly type: 'field'; readonly group: string; readonly key: string; readonly raw: string | boolean }
  | { readonly type: 'display-brightness'; readonly raw: string }
  | { readonly type: 'water-soft-limit'; readonly raw: string }
  | { readonly type: 'topbar-clock'; readonly enabled: boolean }
  | { readonly type: 'machine-refill'; readonly raw: string }
  | { readonly type: 'no-scale-block'; readonly enabled: boolean }
  | { readonly type: 'schedule-toggle'; readonly id: string; readonly enabled: boolean }
  | { readonly type: 'firmware'; readonly file: FirmwareUpload };
