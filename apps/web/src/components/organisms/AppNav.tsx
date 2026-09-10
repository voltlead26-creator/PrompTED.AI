"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/atoms/Icon";
import { PROTECTED_NAV_ITEMS, isProtectedNavItemActive } from "@/lib/app-navigation";
import styles from "./AppNav.module.css";

const CREATE_ITEMS = [
  { href: "/create", label: "Document", icon: "file-text" },
  { href: "/plans?create=ted", label: "Checklist / Action Plan", icon: "list-check" },
  { href: "/workspace", label: "Upload to Master Workspace", icon: "upload" },
] as const;

interface AppNavProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function AppNav({ mobileOpen = false, onClose = () => undefined }: AppNavProps) {
  const pathname = usePathname();
  const createMenuRef = useRef<HTMLDetailsElement>(null);

  function closeCreate() {
    if (createMenuRef.current) createMenuRef.current.open = false;
  }

  function closeNavigation() {
    closeCreate();
    onClose();
  }

  useEffect(() => {
    closeCreate();
  }, [pathname, mobileOpen]);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const menu = createMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      const menu = createMenuRef.current;
      if (event.key !== "Escape" || !menu?.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
      event.preventDefault();
      // Let the first Escape dismiss Create before the enclosing mobile drawer.
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className={styles.backdrop}
          onClick={closeNavigation}
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}
      <nav
        id="app-navigation"
        aria-label="Main navigation"
        className={`${styles.nav}${mobileOpen ? ` ${styles.mobileOpen}` : ""}`}
      >
        <div className={styles.mobileHeader}>
          <span>Menu</span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={closeNavigation}
            aria-label="Close navigation"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <ul className={styles.list}>
          {PROTECTED_NAV_ITEMS.map((item) => {
            const active = isProtectedNavItemActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.link}${active ? ` ${styles.active}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={closeNavigation}
                  title={item.label}
                >
                  <span className={styles.icon} aria-hidden="true">
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span className={styles.label}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={styles.createArea}>
          <details ref={createMenuRef} className={styles.createMenu}>
            <summary className={styles.createSummary}>
              <span className={styles.icon} aria-hidden="true">
                <Icon name="plus" size={20} />
              </span>
              <span className={styles.label}>Create</span>
            </summary>
            <div className={styles.createPanel} aria-label="Create new">
              {CREATE_ITEMS.map(({ href, label, icon }) => (
                <Link
                  key={`${href}-${label}`}
                  href={href}
                  className={styles.createLink}
                  onClick={closeNavigation}
                >
                  <Icon name={icon} size={18} />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </details>
        </div>
      </nav>
    </>
  );
}
