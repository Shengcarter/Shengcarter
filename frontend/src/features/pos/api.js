import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

export const salesKeys = {
  all: ['sales'],
  list: (params) => ['sales', 'list', params],
  detail: (id) => ['sales', 'detail', Number(id)],
  payments: (params) => ['payments', params],
};

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function useSales(params) {
  return useQuery({ queryKey: salesKeys.list(clean(params)), queryFn: () => http.get('/sales', clean(params)), placeholderData: (p) => p });
}

export function useSale(id) {
  return useQuery({ queryKey: salesKeys.detail(id), queryFn: () => http.get(`/sales/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

export function useProducts(params, options = {}) {
  return useQuery({
    queryKey: ['products', 'list', clean(params)],
    queryFn: () => http.get('/products', clean(params)),
    placeholderData: (p) => p,
    ...options,
  });
}

export const salesApi = {
  quote: (body) => http.post('/sales/quote', body).then((r) => r.data),
  create: (body) => http.post('/sales', body),
  addPayment: (id, body) => http.post(`/sales/${id}/payments`, body),
  refund: (id, reason) => http.post(`/sales/${id}/refund`, { reason }),
  voidSale: (id, reason) => http.post(`/sales/${id}/void`, { reason }),
  changeDate: (id, body) => http.patch(`/sales/${id}/date`, body),
  appointmentCheckout: (id) => http.get(`/sales/appointment/${id}`).then((r) => r.data),
};

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
];
