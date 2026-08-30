"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TopBar } from "@/components/organisms/TopBar";
import { AppNav } from "@/components/organisms/AppNav";
import styles from "./AppLayout.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="sr-only focus-visible:not-sr-only">
        Skip to main content
      </a>
      <TopBar
        mobileNavOpen={mobileNavOpen}
        onMenuToggle={() => setMobileNavOpen((open) => !open)}
      />
      <div className={styles.body}>
        <AppNav
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
