"use client";

import { useAuth } from "@/components/providers";
import { LibraryList } from "@/components/organisms/LibraryList";
import { ChecklistLibrary } from "@/components/organisms/ChecklistLibrary";
import { Spinner } from "@/components/atoms/Spinner";
import styles from "./library.module.css";

export default function LibraryPage() {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <section className={styles.page} aria-labelledby="my-work-heading">
        <h1 id="my-work-heading" className={styles.heading}>
          My work
        </h1>
        <Spinner label="Loading your work" showLabel />
      </section>
    );

  return (
    <section className={styles.page} aria-labelledby="my-work-heading">
      <header className={styles.header}>
        <h1 id="my-work-heading" className={styles.heading}>
          My work
        </h1>
      </header>

      {user ? (
        <>
          <LibraryList userId={user.id} />
          <ChecklistLibrary userId={user.id} />
        </>
      ) : (
        <>
          <div className={styles.signInPrompt}>
            <p>Sign in to see work saved to your account.</p>
          </div>
          <ChecklistLibrary />
        </>
      )}
    </section>
  );
}
