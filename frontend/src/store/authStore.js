import { create } from 'zustand';

const BRANCH_KEY = 'zola-branch';

function readSavedBranch() {
  try {
    return Number(localStorage.getItem(BRANCH_KEY)) || null;
  } catch {
    return null;
  }
}

function saveBranch(id) {
  try {
    localStorage.setItem(BRANCH_KEY, String(id));
  } catch {
    /* storage unavailable (private mode) — branch just won't be remembered */
  }
}

/**
 * Session state. The access token lives only in memory (never localStorage);
 * the long-lived refresh token is an httpOnly cookie the browser sends to
 * /api/auth/refresh.
 */
export const useAuthStore = create((set, get) => ({
  status: 'loading', // loading | authenticated | anonymous
  accessToken: null,
  user: null,
  permissions: [],
  branches: [],
  canSwitchBranch: false,
  currentBranchId: null,
  settings: null,
  sessionExpired: false,

  setSession(data) {
    const saved = readSavedBranch();
    const branches = data.branches || [];
    const currentBranchId = branches.some((b) => b.id === saved) ? saved : data.currentBranchId;
    set({
      status: 'authenticated',
      accessToken: data.accessToken ?? get().accessToken,
      user: data.user,
      permissions: data.permissions || [],
      branches,
      canSwitchBranch: Boolean(data.canSwitchBranch),
      currentBranchId,
      settings: data.settings || get().settings,
      sessionExpired: false,
    });
  },

  setSettings(settings) {
    set({ settings });
  },

  clearSession({ expired = false } = {}) {
    set({
      status: 'anonymous',
      accessToken: null,
      user: null,
      permissions: [],
      branches: [],
      canSwitchBranch: false,
      sessionExpired: expired,
    });
  },

  setBranch(id) {
    saveBranch(id);
    set({ currentBranchId: id });
  },

  requirePasswordChange() {
    const { user } = get();
    if (user && !user.mustChangePassword) set({ user: { ...user, mustChangePassword: true } });
  },
}));

/** Permission check usable outside React (e.g. in route definitions). */
export function hasPermission(state, permission) {
  if (!state.user) return false;
  if (state.user.isSuperAdmin) return true;
  const list = Array.isArray(permission) ? permission : [permission];
  return list.some((p) => state.permissions.includes(p));
}
