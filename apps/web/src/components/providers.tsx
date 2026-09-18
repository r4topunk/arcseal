'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi';
import { ChainClockProvider } from './chain-clock';
import { I18nProvider } from './i18n';
import { TxProvider } from './tx';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ChainClockProvider>
            <TxProvider>
              {children}
              <Toaster
                position="bottom-right"
                closeButton
                toastOptions={{
                  classNames: {
                    toast: '!bg-surface !text-foreground !border-hairline-strong !font-sans',
                    description: '!text-muted',
                  },
                }}
              />
            </TxProvider>
          </ChainClockProvider>
        </I18nProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
