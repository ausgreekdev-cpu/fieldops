// Monitoring stub — swap for Sentry without touching call sites
// Usage: import { captureError, captureMessage, addBreadcrumb } from '@/lib/monitoring'

let enabled = false;

export function initMonitoring(dsn?: string) {
  if (!dsn || dsn.includes('placeholder')) {
    console.log('[monitoring] disabled — no DSN');
    return;
  }
  // If @sentry/react-native is installed, uncomment:
  // import * as Sentry from '@sentry/react-native';
  // Sentry.init({ dsn, tracesSampleRate: 0.2 });
  enabled = true;
  console.log('[monitoring] enabled');
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  console.error('[captureError]', error, context);
  if (!enabled) return;
  // Sentry?.captureException(error, { extra: context });
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info') {
  console.log(`[captureMessage:${level}]`, msg);
  if (!enabled) return;
  // Sentry?.captureMessage(msg, level);
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>) {
  console.log('[breadcrumb]', message, data);
  if (!enabled) return;
  // Sentry?.addBreadcrumb({ message, data });
}

export function setUser(user: { id: string; company_id?: string } | null) {
  if (!enabled) return;
  // Sentry?.setUser(user ? { id: user.id, extras: { company_id: user.company_id } } : null);
}
