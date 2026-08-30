"use client";

import type { Recommendation, RecommendationItem } from "@prompted/shared/orchestration";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import styles from "./RecommendationCardGroup.module.css";

interface RecommendationCardGroupProps {
  recommendation: Recommendation;
  onConfirm: (item: RecommendationItem) => void;
  busy?: boolean;
}

export function RecommendationCardGroup({
  recommendation,
  onConfirm,
  busy = false,
}: RecommendationCardGroupProps) {
  const { primary, alternatives } = recommendation;

  return (
    <section className={styles.group} aria-label="TED's recommendation">
      <article className={`${styles.card} ${styles.primary}`}>
        <div className={styles.recommendsTag}>
          <Icon name="star" size={14} />
          <span>Best fit</span>
        </div>
        <h3 className={styles.name}>{primary.name}</h3>
        {primary.use_case && <p className={styles.useCase}>{primary.use_case}</p>}
        {primary.reason && <p className={styles.reason}>{primary.reason}</p>}
        {primary.benefits.length > 0 && (
          <ul className={styles.benefits}>
            {primary.benefits.slice(0, 3).map((benefit) => (
              <li key={benefit}>
                <Icon name="check" size={16} />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => onConfirm(primary)}
          disabled={busy}
        >
          {busy ? "Creating…" : `Create ${primary.name}`}
        </Button>
      </article>

      {alternatives.length > 0 && (
        <details className={styles.alternatives}>
          <summary>See other options</summary>
          <div className={styles.variantRow}>
            {alternatives.map((alternative) => (
              <article key={alternative.name} className={styles.card}>
                <h4 className={styles.variantName}>{alternative.name}</h4>
                {alternative.use_case && <p className={styles.useCase}>{alternative.use_case}</p>}
                <Button
                  variant="ghost"
                  size="md"
                  fullWidth
                  onClick={() => onConfirm(alternative)}
                  disabled={busy}
                >
                  Choose {alternative.name}
                </Button>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
