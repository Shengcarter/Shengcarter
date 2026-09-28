import { useQuery } from '@tanstack/react-query';
import { downloadFile, http } from '../../api/client';

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get('/dashboard').then((r) => r.data),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useReport(type, params, options = {}) {
  return useQuery({
    queryKey: ['reports', type, clean(params)],
    queryFn: () => http.get(`/reports/${type}`, clean(params)).then((r) => r.data),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    ...options,
  });
}

export function useInsights(params, options = {}) {
  return useQuery({
    queryKey: ['insights', clean(params)],
    queryFn: () => http.get('/insights', clean(params)).then((r) => r.data),
    staleTime: 5 * 60_000,
    ...options,
  });
}

export const reportsApi = {
  export: (type, params, format) => downloadFile(`/reports/${type}/export`, { ...clean(params), format }, `report.${format}`),
  refreshInsights: (params) => http.get('/insights', { ...clean(params), refresh: true }).then((r) => r.data),
};
