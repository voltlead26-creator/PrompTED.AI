"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import styles from "./OnboardingModal.module.css";

interface OnboardingModalProps {
  open: boolean;
  onAccept: () => void;
}

/**
 * OnboardingModal — shown once per user on first sign-in.
 * AI disclosure and consent required before proceeding (FR-012, SEC-031).
 * Cannot be dismissed without accepting.
 */
export function OnboardingModal({ open, onAccept }: OnboardingModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-heading"
    >
      <div className={styles.panel}>
        {step === 1 && (
          <div className={styles.content}>
            <div className={styles.tedAvatar} aria-hidden="true">
              <span>TED</span>
            </div>
            <h2 id="onboarding-heading" className={styles.heading}>
              Hi, I&apos;m TED.
            </h2>
            <p className={styles.body}>
              I&apos;m an AI assistant that turns what you&apos;re trying to achieve into a
              real, finished document — step by step, in plain language.
            </p>
            <p className={styles.body}>
              Tell me what&apos;s going on, and I&apos;ll work out what you need.
            </p>
            <Button fullWidth onClick={() => setStep(2)} className={styles.cta}>
              Meet TED →
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className={styles.content}>
            <h2 id="onboarding-heading" className={styles.heading}>
              A quick word before we start
            </h2>

            <div className={styles.disclosure} role="note">
              <h3 className={styles.disclosureHeading}>
                About AI-generated content
              </h3>
              <ul className={styles.disclosureList}>
                <li>
                  I use AI to draft documents. AI can make mistakes — always review
                  before using anything important.
                </li>
                <li>
                  For legal, financial, or medical matters, I&apos;ll flag where you
                  should get professional advice.
                </li>
                <li>
                  Your documents are private and only used to help you, never to train AI
                  models.
                </li>
              </ul>
            </div>

            <p className={styles.body}>
              By clicking &ldquo;Let&apos;s go&rdquo; you confirm you understand that TED
              produces AI-generated drafts for your review.
            </p>
            <p className={styles.privacyLink}>
              Read our{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
                privacy policy
              </a>
              .
            </p>

            <Button fullWidth onClick={onAccept} className={styles.cta}>
              Let&apos;s go
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
