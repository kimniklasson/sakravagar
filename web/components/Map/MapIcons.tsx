import styles from "./Map.module.css";

export function RoadOrXIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${styles.roadIcon} ${expanded ? styles.roadIconExpanded : ""}`}
      width="28"
      height="18"
      viewBox="0 0 28 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M0 1H28" stroke="currentColor" strokeWidth="1" />
      <path d="M0 9H28" stroke="currentColor" strokeWidth="1" strokeDasharray="5 4" />
      <path d="M0 17H28" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WarningIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.warningIcon} ${className ?? ""}`}
      width="14"
      height="14"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.5 2L15.5 14.5H1.5L8.5 2Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M8.5 6.2V9.6M8.5 11.5V12.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function PlusIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.btnIcon} ${className ?? ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M1 8H15M8 15L8 1" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function MinusIcon() {
  return (
    <svg
      className={styles.btnIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M1 8H15" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function LocationIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.btnIcon} ${className ?? ""}`}
      width="16"
      height="16"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9.08308 7.75042L10.3979 15L15.8335 1L1.8335 6.43559L9.08308 7.75042Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}
