import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

export const appointmentKeys = {
  all: ['appointments'],
  calendar: (params) => ['appointments', 'calendar', params],
  list: (params) => ['appointments', 'list', params],
  detail: (id) => ['appointments', 'detail', Number(id)],
  qr: (id) => ['appointments', 'detail', Number(id), 'qr'],
  availability: (params) => ['appointments', 'availability', params],
  availableEmployees: (params) => ['appointments', 'available-employees', params],
};

export function useCalendar(params, options = {}) {
  return useQuery({
    queryKey: appointmentKeys.calendar(params),
    queryFn: () => http.get('/appointments/calendar', params).then((r) => r.data),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    ...options,
  });
}

export function useAppointmentList(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined));
  return useQuery({ queryKey: appointmentKeys.list(clean), queryFn: () => http.get('/appointments', clean), placeholderData: (p) => p });
}

export function useAppointment(id) {
  return useQuery({ queryKey: appointmentKeys.detail(id), queryFn: () => http.get(`/appointments/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

export function useAppointmentQr(id, enabled = true) {
  return useQuery({ queryKey: appointmentKeys.qr(id), queryFn: () => http.get(`/appointments/${id}/qr`).then((r) => r.data), enabled: Boolean(id) && enabled, staleTime: Infinity });
}

export function useAvailability(params, enabled) {
  return useQuery({
    queryKey: appointmentKeys.availability(params),
    queryFn: () => http.get('/appointments/availability', { ...params, employeeIds: params.employeeIds?.join(','), serviceIds: params.serviceIds?.join(',') }).then((r) => r.data),
    enabled,
  });
}

export const appointmentApi = {
  create: (body) => http.post('/appointments', body),
  update: (id, body) => http.patch(`/appointments/${id}`, body),
  reschedule: (id, body) => http.patch(`/appointments/${id}/reschedule`, body),
  setStatus: (id, status, reason) => http.post(`/appointments/${id}/status`, { status, reason }),
  checkIn: (body) => http.post('/appointments/check-in', body),
  checkInById: (id) => http.post(`/appointments/${id}/check-in`),
};
