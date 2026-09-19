import type { ApiSchema } from '../../core/api/api-client';

/** Category union, sourced from the contract (`contracts/src/entities/notification.ts`). */
type NotificationType = ApiSchema<'NotificationType'>;

/**
 * Presentation metadata (label + icon glyph) for the 4 currently-known
 * NotificationType values. This is purely cosmetic — a nicer label/icon for
 * known types — and is NOT relied upon for correctness. Any type not present
 * in this map (including any future NotificationType added to the backend
 * union without a matching frontend update) falls through to
 * DEFAULT_NOTIFICATION_DISPLAY in getNotificationDisplay() below, so the UI
 * never throws or silently drops a notification just because its `type` is
 * unrecognized — the raw `message` field is always rendered regardless.
 */
const KNOWN_TYPE_DISPLAY: Record<NotificationType, { label: string; icon: string }> = {
  INFO: { label: 'Info', icon: 'ℹ️' },
  APPROVAL: { label: 'Approval', icon: '✅' },
  REQUEST: { label: 'Request', icon: '📩' },
  SHIFT: { label: 'Shift', icon: '🗓️' },
};

/** Generic fallback used for any `type` value outside the 4 known literals. */
const DEFAULT_NOTIFICATION_DISPLAY = { label: 'Notification', icon: '🔔' };

/**
 * Resolves the display label/icon for a notification's `type`. Deliberately
 * accepts `string` (not the narrower `NotificationType`) because the value
 * arrives over HTTP from the backend and must be treated as untrusted/wider
 * than the frontend's current type knowledge — a future backend-added type
 * will arrive as a plain string the frontend's union doesn't yet include.
 * Falls back to a generic label/icon for anything not in the known map,
 * which is the explicit extensibility requirement for this feature: the UI
 * must keep working for notification types invented after this code shipped.
 */
export function getNotificationDisplay(type: string): { label: string; icon: string } {
  return (
    (KNOWN_TYPE_DISPLAY as Record<string, { label: string; icon: string }>)[type] ??
    DEFAULT_NOTIFICATION_DISPLAY
  );
}

/** Formats an ISO timestamp as a short, locale-aware date+time for display in the panel. */
export function formatNotificationTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
