"use client";

import {
  QueryClient,
  QueryClientProvider as TanstackProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

export function QueryClientProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000 },
        },
      })
  );

  return <TanstackProvider client={queryClient}>{children}</TanstackProvider>;
}
