"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "@/components/organisms/TopBar";
import { AppNav } from "@/components/organisms/AppNav";
import styles from "./AppLayout.module.css";

const MOBILE_NAV_QUERY = "(max-width: 767px)";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const drawerOpen = isMobile && mobileNavOpen;

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileNavOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!drawerOpen || !navigation) return;
    const returnTarget = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusStops = () => Array.from(navigation.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), summary, [tabindex="0"]',
    )).filter(element => {
      if (element.tabIndex < 0 || element.closest("[hidden], [inert]")) return false;
      const closedDetails = element.closest("details:not([open])");
      return !closedDetails || closedDetails.querySelector("summary") === element;
    });
    focusStops()[0]?.focus();
    const keepFocusInMenu = (event: KeyboardEvent) => {
      // AppNav consumes Escape for its nested Create disclosure first.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") setMobileNavOpen(false);
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const stops = focusStops();
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", keepFocusInMenu);
    return () => {
      window.removeEventListener("keydown", keepFocusInMenu);
      document.body.style.overflow = previousOverflow;
      if (!window.matchMedia(MOBILE_NAV_QUERY).matches) {
        navigation.querySelector<HTMLElement>('a[aria-current="page"]')?.focus();
      } else if (returnTarget instanceof HTMLElement && returnTarget.isConnected && !returnTarget.closest("[inert]")) {
        returnTarget.focus();
      }
    };
  }, [drawerOpen]);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="sr-only focus-visible:not-sr-only" inert={drawerOpen}>
        Skip to main content
      </a>
      <div className={styles.header} inert={drawerOpen}>
        <TopBar
          mobileNavOpen={drawerOpen}
          onMenuToggle={() => setMobileNavOpen((open) => !open)}
        />
      </div>
      <div className={styles.body}>
        <div
          ref={navigationRef}
          className={styles.navigationSlot}
          role={drawerOpen ? "dialog" : undefined}
          aria-modal={drawerOpen ? true : undefined}
          aria-label={drawerOpen ? "Main menu" : undefined}
          inert={isMobile && !drawerOpen}
        >
          <AppNav
            mobileOpen={drawerOpen}
            onClose={() => setMobileNavOpen(false)}
          />
        </div>
        <main id="main-content" tabIndex={-1} className={styles.main} inert={drawerOpen}>
          {children}
        </main>
      </div>
    </div>
  );
}
