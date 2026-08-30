import type { Metadata } from "next";
import Link from "next/link";
import styles from "./PrivacyPage.module.css";

export const metadata: Metadata = {
  title: "Privacy — PrompTED",
  description: "How PrompTED collects, uses, protects, and deletes personal information.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.document}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="PrompTED home">TED</Link>
          <p>Effective 19 August 2026</p>
          <h1>Privacy at PrompTED</h1>
          <p className={styles.lead}>
            PrompTED helps you create useful documents. We treat the information you provide—especially uploaded documents—as private personal information.
          </p>
        </header>

        <section>
          <h2>Information we collect</h2>
          <p>
            We collect account details, the situations and instructions you enter, documents you create or upload, profile information you choose to save, and basic technical information needed to keep the service reliable and secure.
          </p>
        </section>

        <section>
          <h2>Uploaded documents</h2>
          <p>
            Uploaded files and extracted text are used to create or improve your workspace. They are associated with your signed-in account and protected by access controls intended to prevent another user from reading them.
          </p>
        </section>

        <section>
          <h2>AI processing</h2>
          <p>
            PrompTED sends the information needed for your request to external AI services so they can draft, review, or edit your result. We minimise the information sent for each task and do not permit provider keys to enter the browser. Do not upload information you are not authorised to use.
          </p>
        </section>

        <section>
          <h2>Analytics and reliability</h2>
          <p>
            We use privacy-limited product analytics and error monitoring to understand whether workflows succeed. Automatic interaction capture is disabled. Session recording is disabled by default and, if explicitly enabled, form inputs remain masked. Document bodies and uploaded content must not be included in analytics events.
          </p>
        </section>

        <section>
          <h2>Retention and security</h2>
          <p>
            Saved work is retained while your account is active so you can return to it. We use authentication, row-level database controls, private storage, encrypted network connections, and restricted server credentials. No online service can guarantee absolute security.
          </p>
        </section>

        <section>
          <h2>Delete your data</h2>
          <p>
            You can request account deletion from Settings. PrompTED removes the account and associated application data through its deletion workflow. Limited security or infrastructure records may be retained where reasonably necessary to meet legal, fraud-prevention, or operational obligations.
          </p>
          <Link href="/settings/delete-account">Open account deletion</Link>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For a privacy question or access/correction request, contact Little Miss Scarlett through the company website and identify that your request concerns PrompTED.
          </p>
          <a href="https://littlemissscarlett.co" rel="noreferrer">Contact Little Miss Scarlett</a>
        </section>

        <footer className={styles.footer}>
          <Link href="/">Return to PrompTED</Link>
        </footer>
      </article>
    </main>
  );
}
