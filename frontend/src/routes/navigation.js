import {
  BarChart3,
  Bell,
  CalendarDays,
  LayoutDashboard,
  Package,
  Scissors,
  Settings,
  ShoppingBag,
  Truck,
  UserRoundCheck,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Single source of truth for the main navigation. `permission` accepts one
 * code or a list (the item shows when the user has ANY of them). Items with
 * no permission are visible to every signed-in user.
 */
export const NAV_ITEMS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard.view', end: true },
  { label: 'Customers', to: '/customers', icon: Users, permission: 'customers.view' },
  { label: 'Appointments', to: '/appointments', icon: CalendarDays, permission: ['appointments.view', 'appointments.view_own'] },
  { label: 'Services', to: '/services', icon: Scissors, permission: 'services.view' },
  { label: 'Employees', to: '/employees', icon: UserRoundCheck, permission: 'employees.view' },
  { label: 'POS', to: '/pos', icon: ShoppingBag, permission: ['pos.create', 'sales.view'] },
  { label: 'Inventory', to: '/inventory', icon: Package, permission: 'inventory.view' },
  { label: 'Suppliers', to: '/suppliers', icon: Truck, permission: ['suppliers.view', 'purchases.view'] },
  { label: 'Expenses', to: '/expenses', icon: Wallet, permission: 'expenses.view' },
  { label: 'Reports', to: '/reports', icon: BarChart3, permission: ['reports.view', 'reports.financial', 'insights.view'] },
  { label: 'Notifications', to: '/notifications', icon: Bell, permission: null },
  {
    label: 'Settings',
    to: '/settings',
    icon: Settings,
    permission: ['settings.manage', 'users.manage', 'roles.manage', 'branches.manage', 'audit.view', 'backups.manage', 'loyalty.manage'],
  },
];

/** Preferred items for the mobile bottom bar, in order. */
export const MOBILE_PRIORITY = ['/', '/appointments', '/pos', '/customers'];
