"use client";

import { useTheme, useTextSize } from "@/components/providers";
import type { ThemeMode } from "@/components/providers";
import type { TextSize } from "@/components/providers";
import { Icon } from "@/components/atoms/Icon";
import settingsStyles from "../settings.module.css";
import styles from "./AppearancePage.module.css";

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "light", label: "Light", icon: "sun" },
  { mode: "dark", label: "Dark", icon: "moon" },
  { mode: "system", label: "System", icon: "monitor" },
];

const TEXT_SIZE_OPTIONS: { size: TextSize; label: string }[] = [
  { size: "normal", label: "Normal" },
  { size: "large", label: "Large" },
  { size: "larger", label: "Larger" },
];

export default function AppearancePage() {
  const { themeMode, setThemeMode } = useTheme();
  const { textSize, setTextSize } = useTextSize();

  return (
    <section className={settingsStyles.page} aria-labelledby="appearance-heading">
      <header className={settingsStyles.header}>
        <h1 id="appearance-heading" className={settingsStyles.heading}>
          Appearance
        </h1>
      </header>

      <div className={styles.card}>
        <h2 className={styles.cardHeading}>Theme</h2>
        <div className={styles.segmented} role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              className={styles.segment}
              data-active={themeMode === mode || undefined}
              onClick={() => setThemeMode(mode)}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardHeading}>Text size</h2>
        <div className={styles.segmented} role="radiogroup" aria-label="Text size">
          {TEXT_SIZE_OPTIONS.map(({ size, label }) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={textSize === size}
              className={styles.segment}
              data-active={textSize === size || undefined}
              onClick={() => setTextSize(size)}
            >
              <Icon name="text-size" size={18} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
