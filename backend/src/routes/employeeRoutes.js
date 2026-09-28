'use strict';

const { Router } = require('express');
const c = require('../controllers/employeeController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const { singleUpload } = require('../middleware/upload');
const { idParam } = require('../validators/common');
const v = require('../validators/employeeValidators');

// ---- /api/employees ---------------------------------------------------------------
const employeeRouter = Router();
const view = requirePermission('employees.view');
const manage = requirePermission('employees.manage');

employeeRouter.get('/', view, validate({ query: v.listEmployees }), c.list);
// Dropdown list: also needed by booking, POS and user management screens.
employeeRouter.get(
  '/options',
  requirePermission('employees.view', 'appointments.create', 'appointments.view', 'appointments.view_own', 'pos.create', 'users.manage', 'services.manage'),
  validate({ query: v.optionsQuery }),
  c.options,
);
employeeRouter.post('/', manage, validate({ body: v.createEmployee }), c.create);
employeeRouter.get('/:id', view, validate({ params: idParam }), c.get);
employeeRouter.patch('/:id', manage, validate({ params: idParam, body: v.updateEmployee }), c.update);
employeeRouter.delete('/:id', manage, validate({ params: idParam }), c.remove);
employeeRouter.post('/:id/photo', manage, validate({ params: idParam }), singleUpload('photo', 'employees'), c.uploadPhoto);
employeeRouter.put('/:id/schedule', manage, validate({ params: idParam, body: v.schedule }), c.updateSchedule);
employeeRouter.put('/:id/services', manage, validate({ params: idParam, body: v.services }), c.updateServices);
employeeRouter.get('/:id/performance', requirePermission('employees.view', 'payroll.manage'), validate({ params: idParam, query: v.performance }), c.performance);

// ---- /api/attendance --------------------------------------------------------------
const attendanceRouter = Router();
attendanceRouter.get('/', requirePermission('attendance.view', 'attendance.manage'), validate({ query: v.attendanceQuery }), c.attendanceList);
attendanceRouter.get('/today', requirePermission('attendance.view', 'attendance.manage'), c.attendanceToday);
attendanceRouter.get('/me', c.attendanceMine);
// Self clock-in/out or on behalf of others — checked in the service.
attendanceRouter.post('/clock-in', requirePermission('attendance.self', 'attendance.manage'), validate({ body: v.clock }), c.clockIn);
attendanceRouter.post('/clock-out', requirePermission('attendance.self', 'attendance.manage'), validate({ body: v.clock }), c.clockOut);
attendanceRouter.put('/', requirePermission('attendance.manage'), validate({ body: v.attendanceRecord }), c.recordAttendance);

// ---- /api/leave ---------------------------------------------------------------------
const leaveRouter = Router();
leaveRouter.get('/', requirePermission('leave.manage', 'employees.view'), validate({ query: v.leaveQuery }), c.leaveList);
leaveRouter.post('/', requirePermission('leave.manage', 'attendance.self'), validate({ body: v.leaveBody }), c.leaveCreate);
leaveRouter.patch('/:id/status', requirePermission('leave.manage'), validate({ params: idParam, body: v.leaveReview }), c.leaveReview);

module.exports = { employeeRouter, attendanceRouter, leaveRouter };
