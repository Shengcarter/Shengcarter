import { http, refreshSession } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

export async function login(values) {
  const res = await http.post('/auth/login', values);
  useAuthStore.getState().setSession(res.data);
  return res.data;
}

export async function logout() {
  try {
    await http.post('/auth/logout');
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** Restore the session from the refresh cookie when the app loads. */
export async function restoreSession() {
  try {
    await refreshSession();
  } catch {
    useAuthStore.getState().clearSession();
  }
}

export async function reloadSession() {
  const res = await http.get('/auth/me');
  useAuthStore.getState().setSession(res.data);
  return res.data;
}

export async function changePassword(values) {
  const res = await http.post('/auth/change-password', values);
  useAuthStore.getState().setSession(res.data);
  return res;
}

export const forgotPassword = (email) => http.post('/auth/forgot-password', { email });
export const resetPassword = (values) => http.post('/auth/reset-password', values);
