"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers";
import { Icon } from "@/components/atoms/Icon";
import { Spinner } from "@/components/atoms/Spinner";
import styles from "./settings.module.css";

const SETTINGS_LINKS = [
  {
    href: "/settings/profile",
    label: "Profile",
    icon: "user",
    description: "Name, email, preferences",
  },
  {
    href: "/settings/appearance",
    label: "Appearance",
    icon: "sun",
    description: "Light/dark mode and text size",
  },
  {
    href: "/settings/business",
    label: "Business & Brand",
    icon: "building",
    description: "Business profile and brand kit",
  },
  {
    href: "/settings/account",
    label: "Account",
    icon: "credit-card",
    description: "Plan, billing, sign out, delete account",
  },
];

export default function SettingsPage() {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <section className={styles.page} aria-labelledby="settings-heading">
        <h1 id="settings-heading" className={styles.heading}>
          Settings
        </h1>
        <Spinner label="Loading settings" showLabel />
      </section>
    );

  return (
    <section className={styles.page} aria-labelledby="settings-heading">
      <header className={styles.header}>
        <h1 id="settings-heading" className={styles.heading}>
          Settings
        </h1>
        {user && <p className={styles.userEmail}>{user.email}</p>}
      </header>

      <nav aria-label="Settings sections">
        <ul className={styles.linkList}>
          {SETTINGS_LINKS.map(({ href, label, icon, description }) => (
            <li key={href}>
              <Link href={href} className={styles.settingsLink}>
                <span className={styles.linkIcon} aria-hidden="true">
                  <Icon name={icon} size={20} />
                </span>
                <div className={styles.linkText}>
                  <span className={styles.linkLabel}>{label}</span>
                  <span className={styles.linkDesc}>{description}</span>
                </div>
                <Icon name="chevron-right" size={18} className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!user && (
        <div className={styles.danger}>
          <Link href="/sign-in" className={styles.signOutLink}>
            Sign in
          </Link>
        </div>
      )}
    </section>
  );
}
