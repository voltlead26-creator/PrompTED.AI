import { useState } from "react";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase();
}

/**
 * Avatar — user/business identity. Falls back to initials when no image is
 * available or the image fails to load. The name is exposed to AT.
 */
export function Avatar({ name, src, size = "md" }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const showImage = src && !errored;

  return (
    <span
      className={`${styles.avatar} ${styles[size]}`}
      role="img"
      aria-label={name}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className={styles.image}
          onError={() => setErrored(true)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  );
}
