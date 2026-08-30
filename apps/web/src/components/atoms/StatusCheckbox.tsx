import styles from "./StatusCheckbox.module.css";

interface StatusCheckboxProps {
  checked: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}

export function StatusCheckbox({
  checked,
  label,
  onToggle,
  className,
}: StatusCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.checkbox}${checked ? ` ${styles.checked}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{checked ? "✓" : ""}</span>
    </button>
  );
}
