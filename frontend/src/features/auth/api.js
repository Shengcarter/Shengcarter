import { http, refreshSession } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import { useAuthStore } from '../../store/authStore';
import { announceSignOut, goToSignIn } from './sessionSync';

/** Step 1. With two-step sign-in on, returns { twoFactorRequired, challenge } and no session yet. */
export async function login(values) {
  const res = await http.post('/auth/login', values);
  if (res.data.twoFactorRequired) return res.data;
  useAuthStore.getState().setSession(res.data);
  return res.data;
}

/** Step 2: the code from the authenticator app (or a recovery code). */
export async function loginSecondStep(values) {
  const res = await http.post('/auth/login/two-factor', values);
  useAuthStore.getState().setSession(res.data);
  return res.data;
}

/** Two-step sign-in for the signed-in user. */
export const twoFactorApi = {
  status: () => http.get('/auth/two-factor').then((r) => r.data),
  setup: (password) => http.post('/auth/two-factor/setup', { password }).then((r) => r.data),
  confirm: async (code) => {
    const res = await http.post('/auth/two-factor/confirm', { code });
    useAuthStore.getState().setSession(res.data.session);
    return res.data.recoveryCodes;
  },
  disable: async (values) => {
    const res = await http.post('/auth/two-factor/disable', values);
    useAuthStore.getState().setSession(res.data);
  },
  recoveryCodes: (values) => http.post('/auth/two-factor/recovery-codes', values).then((r) => r.data.recoveryCodes),
};

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
