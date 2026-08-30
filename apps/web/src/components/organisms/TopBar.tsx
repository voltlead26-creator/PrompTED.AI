"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Avatar } from "@/components/atoms/Avatar";
import { Icon } from "@/components/atoms/Icon";
import { pageTitleForProtectedPath } from "@/lib/app-navigation";
import styles from "./TopBar.module.css";

function WordMark() {
  return (
    <span className={styles.wordmark} aria-hidden="true">
      <span className={styles.wordmarkPromp}>Promp</span>
      <span className={styles.wordmarkTed}>TED</span>
    </span>
  );
}

export const pageTitleForPathname = pageTitleForProtectedPath;

interface TopBarProps {
  mobileNavOpen?: boolean;
  onMenuToggle?: () => void;
}

export function TopBar({ mobileNavOpen = false, onMenuToggle }: TopBarProps = {}) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const pageTitle = pageTitleForPathname(pathname);

  return (
    <header className={styles.bar}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={onMenuToggle}
        aria-label={mobileNavOpen ? "Close main menu" : "Open main menu"}
        aria-expanded={mobileNavOpen}
        aria-controls="app-navigation"
      >
        <Icon name="menu-2" size={22} />
      </button>

      <Link href="/home" className={styles.logo} aria-label="Go to PrompTED home">
        <span className={styles.logoMark} aria-hidden="true">
          TED
        </span>
        {pageTitle ? (
          <span className={styles.pageTitle}>{pageTitle}</span>
        ) : (
          <>
            <WordMark />
            <span className={styles.brandLine}>AI for the rest of us</span>
          </>
        )}
      </Link>

      <nav aria-label="Account" className={styles.accountNav}>
        {!loading && !user && (
          <Link href="/sign-in" className={styles.signIn}>
            Sign in
          </Link>
        )}
        {!loading && user && (
          <Link href="/settings/profile" aria-label="Your profile">
            <Avatar
              name={
                (typeof user.user_metadata?.display_name === "string" &&
                  user.user_metadata.display_name.trim()) ||
                user.email ||
                "You"
              }
              size="sm"
            />
          </Link>
        )}
      </nav>
    </header>
  );
}
