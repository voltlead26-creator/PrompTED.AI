"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className={styles.backdrop}
          onClick={onClose}
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
            onClick={onClose}
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
                  onClick={onClose}
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
          <details className={styles.createMenu}>
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
                  onClick={onClose}
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
