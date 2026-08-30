"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "light" | "dark";
export type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "theme";

interface ThemeContextValue {
  theme: Theme;
  /** The user's explicit choice — "system" means follow the OS preference. */
  themeMode: ThemeMode;
  setTheme: (theme: Theme) => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  themeMode: "system",
  setTheme: () => {},
  setThemeMode: () => {},
});

function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function readInitialTheme(): Theme {
  const mode = readStoredMode();
  return mode === "system" ? systemTheme() : mode;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      try {
        if (localStorage.getItem(THEME_KEY)) return;
      } catch {
        return;
      }
      const next: Theme = media.matches ? "dark" : "light";
      setThemeState(next);
      applyTheme(next);
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Non-fatal.
    }
    setThemeModeState(next);
    setThemeState(next);
    applyTheme(next);
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    if (mode === "system") {
      try {
        localStorage.removeItem(THEME_KEY);
      } catch {
        // Non-fatal.
      }
      const resolved = systemTheme();
      setThemeModeState("system");
      setThemeState(resolved);
      applyTheme(resolved);
      return;
    }
    setTheme(mode);
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
