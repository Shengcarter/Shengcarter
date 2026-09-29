import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

export const employeeKeys = {
  all: ['employees'],
  list: (params) => ['employees', 'list', params],
  detail: (id) => ['employees', 'detail', Number(id)],
  performance: (id, range) => ['employees', 'detail', Number(id), 'performance', range],
  attendanceToday: ['attendance', 'today'],
  attendance: (params) => ['attendance', 'list', params],
  myAttendance: ['attendance', 'me'],
  leave: (params) => ['leave', params],
};

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function useEmployees(params) {
  return useQuery({ queryKey: employeeKeys.list(clean(params)), queryFn: () => http.get('/employees', clean(params)), placeholderData: (p) => p });
}

export function useEmployee(id) {
  return useQuery({ queryKey: employeeKeys.detail(id), queryFn: () => http.get(`/employees/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

export function useEmployeePerformance(id, range) {
  return useQuery({
    queryKey: employeeKeys.performance(id, range),
    queryFn: () => http.get(`/employees/${id}/performance`, range).then((r) => r.data),
    placeholderData: (p) => p,
  });
}

export function useAttendanceToday(options = {}) {
  return useQuery({ queryKey: employeeKeys.attendanceToday, queryFn: () => http.get('/attendance/today').then((r) => r.data), refetchInterval: 60_000, ...options });
}

export function useAttendance(params, options = {}) {
  return useQuery({ queryKey: employeeKeys.attendance(clean(params)), queryFn: () => http.get('/attendance', clean(params)).then((r) => r.data), placeholderData: (p) => p, ...options });
}

export function useMyAttendance(options = {}) {
  return useQuery({ queryKey: employeeKeys.myAttendance, queryFn: () => http.get('/attendance/me').then((r) => r.data), ...options });
}

export function useLeave(params, options = {}) {
  return useQuery({ queryKey: employeeKeys.leave(clean(params)), queryFn: () => http.get('/leave', clean(params)).then((r) => r.data), ...options });
}

export const employeeApi = {
  create: (body) => http.post('/employees', body),
  update: (id, body) => http.patch(`/employees/${id}`, body),
  remove: (id) => http.delete(`/employees/${id}`),
  uploadPhoto: (id, file) => http.upload(`/employees/${id}/photo`, 'photo', file),
  saveSchedule: (id, days) => http.put(`/employees/${id}/schedule`, { days }),
  saveServices: (id, serviceIds) => http.put(`/employees/${id}/services`, { serviceIds }),
  clockIn: (body = {}) => http.post('/attendance/clock-in', body),
  clockOut: (body = {}) => http.post('/attendance/clock-out', body),
  recordAttendance: (body) => http.put('/attendance', body),
  createLeave: (body) => http.post('/leave', body),
  reviewLeave: (id, status) => http.patch(`/leave/${id}/status`, { status }),
};
