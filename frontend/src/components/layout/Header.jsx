import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Check, KeyRound, LogOut, Menu, Monitor, Moon, Search, Sun, UserRound } from 'lucide-react';
import { Avatar, Dropdown, DropdownItem, IconButton } from '../ui';
import { NotificationBell } from './NotificationBell';
import { GlobalSearch } from './GlobalSearch';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { logout } from '../../features/auth/api';
import { cn } from '../../utils/cn';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function BranchSelector() {
  const branches = useAuthStore((s) => s.branches);
  const canSwitch = useAuthStore((s) => s.canSwitchBranch);
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const setBranch = useAuthStore((s) => s.setBranch);
  const queryClient = useQueryClient();
  const current = branches.find((b) => b.id === currentBranchId);

  if (!current) return null;
  if (!canSwitch || branches.length < 2) {
    return (
      <span className="hidden items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted md:inline-flex">
        <Building2 className="size-4" aria-hidden /> {current.name}
      </span>
    );
  }

  return (
    <Dropdown
      align="right"
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm text-fg hover:bg-surface-2"
          aria-label={`Current branch: ${current.name}. Switch branch`}
        >
          <Building2 className="size-4 text-accent" aria-hidden />
          <span className="hidden max-w-36 truncate md:inline">{current.name}</span>
        </button>
      )}
    >
      {({ close }) => (
        <>
          <p className="px-3 pt-1 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">Switch branch</p>
          {branches.map((b) => (
            <DropdownItem
              key={b.id}
              onClick={() => {
                close();
                if (b.id === currentBranchId) return;
                setBranch(b.id);
                queryClient.invalidateQueries();
                toast.success(`Switched to ${b.name}`);
              }}
            >
              <span className="flex-1">{b.name}</span>
              {b.id === currentBranchId ? <Check className="size-4 text-accent" /> : null}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function ThemeSelector() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const current = THEMES.find((t) => t.value === theme) || THEMES[1];
  return (
    <Dropdown width="w-40" trigger={({ props }) => <IconButton icon={current.icon} label={`Theme: ${current.label}`} {...props} />}>
      {({ close }) =>
        THEMES.map((t) => (
          <DropdownItem
            key={t.value}
            icon={t.icon}
            onClick={() => {
              setTheme(t.value);
              close();
            }}
          >
            <span className="flex-1">{t.label}</span>
            {t.value === theme ? <Check className="size-4 text-accent" /> : null}
          </DropdownItem>
        ))
      }
    </Dropdown>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onLogout = async () => {
    await logout();
    queryClient.clear();
    navigate('/login', { replace: true });
    toast.success('You have been signed out');
  };

  return (
    <Dropdown
      width="w-64"
      trigger={({ props }) => (
        <button type="button" {...props} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 hover:bg-surface-2" aria-label="Account menu">
          <Avatar name={user?.fullName} src={user?.avatar} size="sm" />
          <span className="hidden text-left leading-tight xl:block">
            <span className="block max-w-36 truncate text-sm font-medium">{user?.fullName}</span>
            <span className="block text-xs text-muted">{user?.role?.name}</span>
          </span>
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold">{user?.fullName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
            <p className="mt-1 text-xs text-accent">{user?.role?.name}</p>
          </div>
          <div className="pt-1.5">
            <DropdownItem icon={UserRound} onClick={() => { close(); navigate('/profile'); }}>My profile</DropdownItem>
            <DropdownItem icon={KeyRound} onClick={() => { close(); navigate('/profile?tab=password'); }}>Change password</DropdownItem>
            <DropdownItem icon={LogOut} danger onClick={() => { close(); onLogout(); }}>Sign out</DropdownItem>
          </div>
        </>
      )}
    </Dropdown>
  );
}

export function Header({ onOpenNav }) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <IconButton icon={Menu} label="Open navigation" onClick={onOpenNav} className="lg:hidden" />

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={cn(
            'flex h-10 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-muted transition-colors hover:border-gold-500/40 sm:max-w-md',
          )}
          aria-label="Search (Ctrl+K)"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search…</span>
          <kbd className="ml-auto hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] sm:inline">Ctrl K</kbd>
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <BranchSelector />
          <ThemeSelector />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
