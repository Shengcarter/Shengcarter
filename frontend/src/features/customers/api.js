import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

export const customerKeys = {
  all: ['customers'],
  list: (params) => ['customers', 'list', params],
  detail: (id) => ['customers', 'detail', Number(id)],
  history: (id, kind, params) => ['customers', 'detail', Number(id), kind, params],
  notes: (id) => ['customers', 'detail', Number(id), 'notes'],
};

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function useCustomers(params, options = {}) {
  return useQuery({
    queryKey: customerKeys.list(clean(params)),
    queryFn: () => http.get('/customers', clean(params)),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCustomer(id) {
  return useQuery({ queryKey: customerKeys.detail(id), queryFn: () => http.get(`/customers/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

export function useCustomerHistory(id, kind, params) {
  return useQuery({
    queryKey: customerKeys.history(id, kind, params),
    queryFn: () => http.get(`/customers/${id}/${kind}`, params),
    placeholderData: (prev) => prev,
  });
}

export function useCustomerNotes(id) {
  return useQuery({ queryKey: customerKeys.notes(id), queryFn: () => http.get(`/customers/${id}/notes`).then((r) => r.data) });
}

export const customerApi = {
  create: (body) => http.post('/customers', body),
  update: (id, body) => http.patch(`/customers/${id}`, body),
  remove: (id) => http.delete(`/customers/${id}`),
  addNote: (id, note) => http.post(`/customers/${id}/notes`, { note }),
  deleteNote: (id, noteId) => http.delete(`/customers/${id}/notes/${noteId}`),
  uploadPhoto: (id, file) => http.upload(`/customers/${id}/photo`, 'photo', file),
  adjustLoyalty: (id, body) => http.post(`/customers/${id}/loyalty/adjust`, body),
};
