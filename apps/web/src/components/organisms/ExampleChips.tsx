"use client";

import { EXAMPLE_CHIPS, rotateChips } from "@prompted/shared/example-chips";
import { Chip } from "@/components/atoms/Chip";
import { Icon } from "@/components/atoms/Icon";
import styles from "./ExampleChips.module.css";

interface ExampleChipsProps {
  /** Called with the chip's fill text. Fills the composer — does not submit. */
  onPick: (fill: string) => void;
  /** Opens the Browse modal (categorised list). */
  onBrowse: () => void;
}

export function dailyChipSeed(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000;
}

export function ExampleChips({ onPick, onBrowse }: ExampleChipsProps) {
  // Stable per-day rotation so the set doesn't reshuffle on every render.
  const seed = dailyChipSeed();
  const chips = rotateChips(EXAMPLE_CHIPS, seed, 5);

  return (
    <section className={styles.wrap} aria-label="Example situations">
      <p className={styles.caption}>Examples</p>
      <div className={styles.row}>
        {chips.map((chip) => (
          <Chip key={chip.label} onClick={() => onPick(chip.fill)}>
            {chip.label}
          </Chip>
        ))}
        <Chip
          onClick={onBrowse}
          ariaLabel="Browse all situations"
          leadingIcon={<Icon name="search" size={16} />}
        >
          Browse
        </Chip>
      </div>
    </section>
  );
}
