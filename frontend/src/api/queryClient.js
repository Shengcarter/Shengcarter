import { QueryClient } from '@tanstack/react-query';

/** The app's data cache, shared so signing out can wipe everything loaded for the previous person. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => count < 2 && (!error?.status || error.status >= 500),
    },
    mutations: { retry: false },
  },
});
