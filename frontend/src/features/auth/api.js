import { http, refreshSession } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import { useAuthStore } from '../../store/authStore';
import { announceSignOut, goToSignIn } from './sessionSync';

export async function login(values) {
  const res = await http.post('/auth/login', values);
  useAuthStore.getState().setSession(res.data);
  return res.data;
}

/**
 * Sign out: the server ends the session (both tokens stop working), this tab
 * forgets everything it loaded, other tabs follow, and the page is left with
 * a hard navigation that replaces the history entry — so Back cannot show a
 * signed-in screen again.
 */
export async function logout() {
  try {
    await http.post('/auth/logout');
  } catch {
    /* offline: the session still ends here, and on the server when it expires */
  } finally {
    useAuthStore.getState().clearSession();
    queryClient.clear();
    announceSignOut();
    goToSignIn();
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
