import styles from "./RouteState.module.css";

export default function AppLoading() {
  return (
    <main className={styles.state} aria-busy="true" aria-live="polite">
      <section className={styles.panel}>
        <h1 className={styles.title}>Opening your workspace</h1>
        <p className={styles.message}>
          Loading your saved document and latest workflow state.
        </p>
        <div className={styles.progress} aria-hidden="true" />
      </section>
    </main>
  );
}
