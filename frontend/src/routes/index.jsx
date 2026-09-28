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
      {
        path: 'settings/*',
        element: guard(['settings.manage', 'users.manage', 'roles.manage', 'branches.manage', 'audit.view', 'backups.manage', 'loyalty.manage'], <SettingsPage />),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
