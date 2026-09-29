import { useEffect, useState } from 'react';
import { useAuthStore, hasPermission } from '../store/authStore';

/** Debounce a changing value (used by search fields). */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Returns a `can(permission)` checker bound to the signed-in user. */
export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  return (permission) => hasPermission({ user, permissions }, permission);
}

export function useSettings() {
  return useAuthStore((s) => s.settings) || {};
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    listener();
    return () => media.removeEventListener('change', listener);
  }, [query]);
  return matches;
}

/** Update document.title with the page name and the system name. */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ZOLA STYLISH MANAGEMENT SYSTEM` : 'ZOLA STYLISH MANAGEMENT SYSTEM';
  }, [title]);
}
