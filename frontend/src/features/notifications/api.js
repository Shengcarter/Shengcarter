import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../../api/client';

export const notificationKeys = {
  all: ['notifications'],
  list: (params) => ['notifications', 'list', params],
  unread: ['notifications', 'unread'],
};

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: () => http.get('/notifications/unread-count').then((r) => r.data),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useNotifications(params, options = {}) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => http.get('/notifications', params),
    ...options,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => http.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
