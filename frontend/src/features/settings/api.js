import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { http } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

export const settingsKeys = {
  all: ['settings'],
  users: (params) => ['users', params],
  roles: ['roles'],
  permissions: ['permissions'],
  branches: ['branches'],
  activity: (params) => ['activity-logs', params],
};

export function useAdminSettings() {
  return useQuery({ queryKey: settingsKeys.all, queryFn: () => http.get('/settings').then((r) => r.data) });
}

/** Refresh the public settings (currency, timezone…) used by the whole app. */
export async function refreshAppSettings() {
  const res = await http.get('/settings/app');
  useAuthStore.getState().setSettings(res.data);
}

export function useSaveSettings(group) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values) => http.put(`/settings/${group}`, values),
    onSuccess: async (res) => {
      toast.success(res.message);
      await Promise.all([qc.invalidateQueries({ queryKey: settingsKeys.all }), refreshAppSettings()]);
    },
  });
}

export function useUsers(params) {
  return useQuery({ queryKey: settingsKeys.users(params), queryFn: () => http.get('/users', params), placeholderData: (prev) => prev });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: settingsKeys.roles, queryFn: () => http.get('/roles').then((r) => r.data), enabled });
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: settingsKeys.permissions, queryFn: () => http.get('/roles/permissions').then((r) => r.data) });
}

export function useBranches(enabled = true) {
  return useQuery({ queryKey: settingsKeys.branches, queryFn: () => http.get('/branches').then((r) => r.data), enabled });
}

export function useActivityLogs(params) {
  return useQuery({ queryKey: settingsKeys.activity(params), queryFn: () => http.get('/activity-logs', params), placeholderData: (prev) => prev });
}

/** Generic mutation helper: runs `fn`, toasts the server message, invalidates keys. */
export function useApiMutation(fn, invalidate = [], { silent = false } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      if (!silent && res?.message) toast.success(res.message);
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
  });
}
