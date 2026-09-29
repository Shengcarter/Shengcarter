import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

export const serviceKeys = {
  all: ['services'],
  list: (params) => ['services', 'list', params],
  categories: ['service-categories'],
};

export function useServices(params = {}, options = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined));
  return useQuery({
    queryKey: serviceKeys.list(clean),
    queryFn: () => http.get('/services', clean).then((r) => r.data),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    ...options,
  });
}

export function useServiceCategories(options = {}) {
  return useQuery({ queryKey: serviceKeys.categories, queryFn: () => http.get('/service-categories').then((r) => r.data), staleTime: 60_000, ...options });
}

export function useEmployeeOptions(params = {}, options = {}) {
  return useQuery({
    queryKey: ['employees', 'options', params],
    queryFn: () => http.get('/employees/options', params).then((r) => r.data),
    staleTime: 60_000,
    ...options,
  });
}

export const serviceApi = {
  create: (body) => http.post('/services', body),
  update: (id, body) => http.patch(`/services/${id}`, body),
  remove: (id) => http.delete(`/services/${id}`),
  createCategory: (body) => http.post('/service-categories', body),
  updateCategory: (id, body) => http.patch(`/service-categories/${id}`, body),
  removeCategory: (id) => http.delete(`/service-categories/${id}`),
};
