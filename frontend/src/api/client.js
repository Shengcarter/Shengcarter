import axios from 'axios';
import { useAuthStore } from '../store/authStore';

/**
 * Axios instance for the ZOLA STYLISH MANAGEMENT SYSTEM API.
 * - Adds the in-memory access token and the selected branch to every request.
 * - On 401 it refreshes the session once (shared across parallel requests)
 *   using the httpOnly refresh cookie, then retries the original request.
 * - Errors are normalized into ApiRequestError with a user-friendly message.
 */
export const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 30_000 });

export class ApiRequestError extends Error {
  constructor({ message, status = 0, errors = [], code = null }) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

function normalizeError(error) {
  if (error instanceof ApiRequestError) return error;
  if (axios.isCancel(error)) return new ApiRequestError({ message: 'Request cancelled', code: 'CANCELLED' });
  if (!error.response) {
    return new ApiRequestError({
      message: error.code === 'ECONNABORTED'
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the server. Check your network connection and that the server is running.',
      code: 'NETWORK_ERROR',
    });
  }
  const { status, data } = error.response;
  return new ApiRequestError({
    status,
    message: data?.message || `Request failed (${status})`,
    errors: data?.errors || [],
    code: data?.code || null,
  });
}

api.interceptors.request.use((config) => {
  const { accessToken, currentBranchId } = useAuthStore.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (currentBranchId) config.headers['X-Branch-Id'] = String(currentBranchId);
  return config;
});

let refreshPromise = null;

/** Exchange the refresh cookie for a new access token (deduplicated). */
export function refreshSession() {
  if (!refreshPromise) {
    const { currentBranchId } = useAuthStore.getState();
    refreshPromise = axios
      .post('/api/auth/refresh', null, {
        withCredentials: true,
        headers: currentBranchId ? { 'X-Branch-Id': String(currentBranchId) } : {},
      })
      .then((res) => {
        useAuthStore.getState().setSession(res.data.data);
        return res.data.data;
      })
      .catch((error) => {
        throw normalizeError(error);
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;
    const isAuthCall = config?.url?.startsWith('/auth/login') || config?.url?.startsWith('/auth/refresh');

    if (response?.status === 401 && config && !config._retried && !isAuthCall) {
      config._retried = true;
      try {
        await refreshSession();
        return api(config);
      } catch {
        useAuthStore.getState().clearSession({ expired: true });
      }
    }
    // File downloads receive errors as a Blob; read the JSON message inside.
    if (response?.data instanceof Blob && response.data.type.includes('json')) {
      try {
        response.data = JSON.parse(await response.data.text());
      } catch {
        // Keep the generic message.
      }
    }
    if (response?.status === 403 && response.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      useAuthStore.getState().requirePasswordChange();
    }
    return Promise.reject(normalizeError(error));
  },
);

/** Unwrap the { success, message, data, pagination } envelope. */
export async function request(config) {
  const res = await api(config);
  return res.data;
}

export const http = {
  get: (url, params, options) => request({ method: 'get', url, params, ...options }),
  post: (url, data, options) => request({ method: 'post', url, data, ...options }),
  put: (url, data, options) => request({ method: 'put', url, data, ...options }),
  patch: (url, data, options) => request({ method: 'patch', url, data, ...options }),
  delete: (url, options) => request({ method: 'delete', url, ...options }),
  upload: (url, field, file, extra = {}) => {
    const form = new FormData();
    form.append(field, file);
    Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    return request({ method: 'post', url, data: form, headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

/** Download a file (PDF / Excel / CSV) from an authenticated endpoint. */
export async function downloadFile(url, params, fallbackName = 'download') {
  const res = await api.get(url, { params, responseType: 'blob', timeout: 120_000 });
  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const blobUrl = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/** Open an authenticated PDF in a new tab (for printing). */
export async function openFile(url, params) {
  const win = window.open('', '_blank');
  const res = await api.get(url, { params, responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data);
  if (win) win.location.href = blobUrl;
  else window.location.href = blobUrl;
}
