import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import AuthLayout from '../layouts/AuthLayout';
import { HomeRedirect, PublicOnly, RequireAuth, RequirePermission } from './guards';

// Every page is code-split so the initial download stays small.
const LoginPage = lazy(() => import('../pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('../pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../pages/auth/ResetPasswordPage'));
const ChangePasswordPage = lazy(() => import('../pages/auth/ChangePasswordPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const NotificationsPage = lazy(() => import('../features/notifications/NotificationsPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const CustomersPage = lazy(() => import('../features/customers/CustomersPage'));
const CustomerProfilePage = lazy(() => import('../features/customers/CustomerProfilePage'));
const ServicesPage = lazy(() => import('../features/services/ServicesPage'));
const EmployeesPage = lazy(() => import('../features/employees/EmployeesPage'));
const EmployeeProfilePage = lazy(() => import('../features/employees/EmployeeProfilePage'));
const AppointmentsPage = lazy(() => import('../features/appointments/AppointmentsPage'));
const CheckInPage = lazy(() => import('../pages/CheckInPage'));
const PosPage = lazy(() => import('../features/pos/PosPage'));
const SalesPage = lazy(() => import('../features/pos/SalesPage'));
const SaleDetailPage = lazy(() => import('../features/pos/SaleDetailPage'));
const InventoryPage = lazy(() => import('../features/inventory/InventoryPage'));
const SuppliersPage = lazy(() => import('../features/suppliers/SuppliersPage'));
const ExpensesPage = lazy(() => import('../features/expenses/ExpensesPage'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));

const guard = (permission, element) => <RequirePermission permission={permission}>{element}</RequirePermission>;

export const router = createBrowserRouter([
  {
    element: (
      <PublicOnly>
        <AuthLayout />
      </PublicOnly>
    ),
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  // Opened by scanning an appointment QR code (public; staff can check in).
  { path: '/check-in/:token', element: <CheckInPage /> },
  {
    path: '/change-password',
    element: (
      <RequireAuth allowPasswordChange>
        <ChangePasswordPage />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect><DashboardPage /></HomeRedirect> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'customers', element: guard('customers.view', <CustomersPage />) },
      { path: 'customers/:id', element: guard('customers.view', <CustomerProfilePage />) },
      { path: 'services', element: guard('services.view', <ServicesPage />) },
      { path: 'employees', element: guard('employees.view', <EmployeesPage />) },
      { path: 'employees/:id', element: guard('employees.view', <EmployeeProfilePage />) },
      { path: 'appointments', element: guard(['appointments.view', 'appointments.view_own'], <AppointmentsPage />) },
      { path: 'pos', element: guard('pos.create', <PosPage />) },
      { path: 'pos/sales', element: guard('sales.view', <SalesPage />) },
      { path: 'pos/sales/:id', element: guard(['sales.view', 'pos.create'], <SaleDetailPage />) },
      { path: 'inventory', element: guard('inventory.view', <InventoryPage />) },
      { path: 'suppliers', element: guard(['suppliers.view', 'purchases.view'], <SuppliersPage />) },
      { path: 'expenses', element: guard('expenses.view', <ExpensesPage />) },
      { path: 'reports', element: guard(['reports.view', 'reports.financial', 'insights.view'], <ReportsPage />) },
      {
        path: 'settings/*',
        element: guard(['settings.manage', 'users.manage', 'roles.manage', 'branches.manage', 'audit.view', 'backups.manage', 'loyalty.manage'], <SettingsPage />),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
