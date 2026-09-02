import styles from "./StatusCheckbox.module.css";

interface StatusCheckboxProps {
  checked: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
  disabled?: boolean;
}

export function StatusCheckbox({
  checked,
  label,
  onToggle,
  className,
  disabled = false,
}: StatusCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.checkbox}${checked ? ` ${styles.checked}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span aria-hidden="true">{checked ? "✓" : ""}</span>
    </button>
  );
}
