/**
 * Framework-free action context shared by feature bindings and flows.
 *
 * This contract deliberately lives outside the composition root: controllers
 * may describe the actions they support without importing BeanieApp or its
 * complete application state.
 */
export interface ClickActionContext {
  el: HTMLElement;
  id?: string;
  field?: string;
  index?: string;
  value?: string;
}

export type ClickActionHandler = (context: ClickActionContext) => void | Promise<void>;

/** Modal identifiers shared by feature flows and the composition shell. */
export type AppModal =
  | 'bean-picker'
  | 'batch-storage'
  | 'edit-number'
  | 'edit-shot'
  | 'machine-label'
  | 'no-scale-shot'
  | 'label-scanner'
  | 'delete-shot'
  | 'shot-stages'
  | 'cleaning-wizard'
  | 'import-profile'
  | 'delete-profile'
  | 'notes-editor'
  | 'derek'
  | null;
