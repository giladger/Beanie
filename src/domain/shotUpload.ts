// Decent shot-upload facts, read from the durable markers the gateway's
// bundled shot-upload plugin (shot-upload.reaplugin) writes onto a shot:
//
//   annotations.extras.uploaded_to_decent   unix seconds of the accepted upload
//   annotations.extras.decent_upload_rejected  { status, timestamp } for a
//     shot-specific rejection (cleared back to null on a later success)
//
// Beanie only reads these; the plugin owns writing them. A shot with neither
// marker simply hasn't been uploaded (or the plugin is off) — that absence is
// not displayed. Uploaded wins over a stale rejection, matching the plugin's
// own precedence when both are present.

import type { ShotSummary } from '../api/types';

export type DecentUploadFact =
  | { kind: 'uploaded'; at: Date | null }
  | { kind: 'rejected'; httpStatus: number | null; at: Date | null };

export function decentUploadFact(shot: ShotSummary): DecentUploadFact | null {
  const extras = shot.annotations?.extras;
  if (!extras || typeof extras !== 'object') return null;
  const record = extras as Record<string, unknown>;

  const uploaded = record.uploaded_to_decent;
  if (uploaded) return { kind: 'uploaded', at: markerDate(uploaded) };

  const rejected = record.decent_upload_rejected;
  if (rejected && typeof rejected === 'object') {
    const r = rejected as Record<string, unknown>;
    return {
      kind: 'rejected',
      httpStatus: typeof r.status === 'number' && Number.isFinite(r.status) ? r.status : null,
      at: markerDate(r.timestamp)
    };
  }
  return null;
}

/** Full-sentence fact for tooltips: what happened, and when if known. */
export function decentUploadTitle(fact: DecentUploadFact): string {
  const when = fact.at ? ` · ${formatMarkerDate(fact.at)}` : '';
  if (fact.kind === 'uploaded') return `Uploaded to Decent${when}`;
  const status = fact.httpStatus != null ? ` (HTTP ${fact.httpStatus})` : '';
  return `Decent upload rejected${status}${when}`;
}

/** Short inline text for a facts line: "Uploaded to Decent" / "Decent upload rejected". */
export function decentUploadLabel(fact: DecentUploadFact): string {
  return fact.kind === 'uploaded' ? 'Uploaded to Decent' : 'Decent upload rejected';
}

// The plugin writes unix seconds; tolerate milliseconds and reject junk.
function markerDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value >= 1e12 ? value : value * 1000);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatMarkerDate(date: Date): string {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
