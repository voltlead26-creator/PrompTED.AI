import type { ReactNode } from "react";
import styles from "./AuthLayout.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.card}>{children}</main>
    </div>
  );
}
