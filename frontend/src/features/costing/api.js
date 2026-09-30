import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

/** Products that can be recorded as used on a service, in the unit they are used in. */
export function useUsableProducts(options = {}) {
  return useQuery({
    queryKey: ['products', 'usable'],
    queryFn: () => http.get('/products/usable').then((r) => r.data),
    staleTime: 30_000,
    ...options,
  });
}

export function useAppointmentProducts(appointmentId, options = {}) {
  return useQuery({
    queryKey: ['appointments', appointmentId, 'products'],
    queryFn: () => http.get(`/appointments/${appointmentId}/products`).then((r) => r.data),
    enabled: Boolean(appointmentId),
    ...options,
  });
}

export const costingApi = {
  recordAppointmentProducts: (appointmentId, services) => http.put(`/appointments/${appointmentId}/products`, { services }),
  correct: (saleId, itemId, body) => http.patch(`/sales/${saleId}/items/${itemId}/costing`, body),
  review: (saleId, itemId, note) => http.post(`/sales/${saleId}/items/${itemId}/costing/review`, { note }),
};
