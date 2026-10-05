import { http } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import { useAuthStore } from '../../store/authStore';

/**
 * Keeps every open tab honest about the session:
 *  • signing out in one tab signs out all of them (BroadcastChannel, with a
 *    storage-event fallback that carries no token, only "signed out");
 *  • a page the browser restores from its back/forward cache is reloaded, so
 *    it is checked against the server instead of showing old data;
 *  • when a tab comes back into view the session is checked again, so one
 *    that ended elsewhere (signed out, expired, password changed) goes to the
 *    sign-in page;
 *  • whenever the session ends, everything loaded for that person is wiped.
 * The server is the authority: these only make the screen follow it quickly.
 */
const CHANNEL = 'zola-auth';
const STORAGE_KEY = 'zola-signed-out';
const RECHECK_MS = 60_000;

let channel = null;
let started = false;
let lastCheck = 0;

function openChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/** Leave every signed-in screen: hard navigation, replacing the current history entry. */
export function goToSignIn(reason = 'signedOut') {
  window.location.replace(`/login?${reason}=1`);
}

/** Tell the other tabs this browser signed out. */
export function announceSignOut() {
  try {
    openChannel()?.postMessage({ type: 'signed-out' });
  } catch {
    /* channel closed */
  }
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the visibility check still catches it */
  }
}

function signedOutElsewhere() {
  if (useAuthStore.getState().status !== 'authenticated') return;
  useAuthStore.getState().clearSession();
  queryClient.clear();
  goToSignIn();
}

async function recheck() {
  const { status } = useAuthStore.getState();
  if (status !== 'authenticated' || Date.now() - lastCheck < RECHECK_MS) return;
  lastCheck = Date.now();
  try {
    // An ended session answers 401; the API client then tries the refresh
    // cookie once and, if that fails too, clears the session (→ sign-in page).
    await http.get('/auth/me');
  } catch {
    /* handled by the API client */
  }
}

export function startSessionSync() {
  if (started || typeof window === 'undefined') return;
  started = true;

  openChannel()?.addEventListener('message', (event) => {
    if (event.data?.type === 'signed-out') signedOutElsewhere();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) signedOutElsewhere();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recheck();
  });

  // Whenever the session ends (signed out, expired, revoked), drop its data.
  useAuthStore.subscribe((state, previous) => {
    if (previous.status === 'authenticated' && state.status === 'anonymous') queryClient.clear();
  });
}
