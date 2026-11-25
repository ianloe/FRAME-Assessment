export function formatDate(input: string | Date | null | undefined, timeZone = 'Asia/Singapore'): string {
  if (!input) return 'Not set';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone
  }).format(d);
}

export function formatDateTime(input: string | Date | null | undefined, timeZone = 'Asia/Singapore'): string {
  if (!input) return 'Not set';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  }).format(d);
}
