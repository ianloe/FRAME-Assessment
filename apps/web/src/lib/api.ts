let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (!res.ok) {
    let errBody: { error?: string; code?: string; [key: string]: unknown } = {};
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: res.statusText };
    }
    throw new ApiError(
      errBody.error ?? 'Request failed',
      res.status,
      errBody.code,
      errBody
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (data && typeof data === 'object' && 'csrfToken' in data && typeof data.csrfToken === 'string') {
      setCsrfToken(data.csrfToken);
    }
    return data as T;
  }
  return (await res.text()) as unknown as T;
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let errBody: { error?: string; code?: string } = {};
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: res.statusText };
    }
    throw new ApiError(errBody.error ?? 'Download failed', res.status, errBody.code, errBody);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
