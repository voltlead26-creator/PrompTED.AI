"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "./RouteState.module.css";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is safe to correlate; document content and raw errors are not.
    console.error("app_route_failed", { digest: error.digest ?? "unavailable" });
  }, [error.digest]);

  return (
    <main className={styles.state}>
      <section className={styles.panel} role="alert">
        <h1 className={styles.title}>This workspace did not open</h1>
        <p className={styles.message}>
          Your saved document has not been replaced. Try reconnecting, or return home and
          reopen it from your library.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={reset}>
            Try again
          </button>
          <Link className={styles.link} href="/home">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
