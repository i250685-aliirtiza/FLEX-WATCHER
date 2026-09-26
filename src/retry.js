export function retryDelay(failures, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(0, failures - 1), 30));
}

export function classifyFailure(error) {
  if (error?.code === 'LOGIN_REQUIRED') return 'AUTH EXPIRED';
  if (error?.code === 'NETWORK_FAILURE') return 'TRANSIENT FAILURE';
  if (error?.code === 'HTTP_ERROR') return 'FLEX HTTP FAILURE';
  if (['INVALID_MARKS_PAGE', 'INVALID_HTML', 'INVALID_CONTENT_TYPE', 'ROUTING_FAILED',
    'HUMAN_VERIFICATION_REQUIRED', 'SEMESTER_MISMATCH', 'INTEGRITY_FAILURE'].includes(error?.code)) {
    return 'UNEXPECTED FLEX RESPONSE';
  }
  return 'LOCAL WATCH FAILURE';
}
