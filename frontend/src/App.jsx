import { Suspense, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { router } from './routes';
import { SplashScreen } from './routes/guards';
import { restoreSession } from './features/auth/api';
import { startSessionSync } from './features/auth/sessionSync';
import { queryClient } from './api/queryClient';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';

export default function App() {
  const isDark = useThemeStore((s) => s.isDark);
  const initTheme = useThemeStore((s) => s.init);
  const defaultTheme = useAuthStore((s) => s.settings?.system?.default_theme);

  useEffect(() => {
    startSessionSync();
    restoreSession();
  }, []);

  useEffect(() => {
    initTheme(defaultTheme);
  }, [initTheme, defaultTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<SplashScreen />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster
        position="top-center"
        theme={isDark ? 'dark' : 'light'}
        richColors
        closeButton
        toastOptions={{ className: 'font-sans' }}
      />
    </QueryClientProvider>
  );
}

export { queryClient };
