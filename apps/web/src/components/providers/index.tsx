"use client";

import type { ReactNode } from "react";
import { QueryClientProvider } from "./QueryClientProvider";
import { AuthProvider } from "./AuthProvider";
import { ThemeProvider } from "./ThemeProvider";
import { TextSizeProvider } from "./TextSizeProvider";
import { ToastProvider } from "@/components/atoms/Toast";
import { MonitoringProvider } from "./MonitoringProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider>
      <AuthProvider>
        <MonitoringProvider>
          <ThemeProvider>
            <TextSizeProvider>
              <ToastProvider>{children}</ToastProvider>
            </TextSizeProvider>
          </ThemeProvider>
        </MonitoringProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export { useAuth } from "./AuthProvider";
export { useTheme } from "./ThemeProvider";
export type { ThemeMode } from "./ThemeProvider";
export { useTextSize } from "./TextSizeProvider";
export type { TextSize } from "./TextSizeProvider";
