import styles from "./Map.module.css";

type LayerIconName = "layers" | "help" | "close" | "accidents" | "flow" | "camera" | "disturbances" | "speed";

export function LayerIconButton({
  label,
  icon,
  on,
  onToggle,
  badgeCount,
  onBadgeClick,
  loading = false,
  className,
}: {
  label: string;
  icon: LayerIconName;
  on: boolean;
  onToggle: () => void;
  badgeCount?: number;
  onBadgeClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const showBadge = on && typeof badgeCount === "number" && badgeCount > 0;
  const tooltipLabel = label.startsWith("Stäng") ? label : `Visa ${label.toLowerCase()}`;
  const buttonLabel = loading ? `${label} laddas` : label;
  return (
    <span className={`${styles.layerIconItem} ${className ?? ""}`}>
      <button
        type="button"
        className={`${styles.layerIconBtn} ${on ? styles.layerIconBtnOn : ""} ${
          loading ? styles.layerIconBtnLoading : ""
        }`}
        onClick={onToggle}
        aria-label={buttonLabel}
        aria-busy={loading || undefined}
        aria-pressed={on}
        data-label={loading ? `Laddar ${label.toLowerCase()}` : tooltipLabel}
      >
        <span className={styles.layerIconVisual} aria-hidden="true">
          <span
            className={`${styles.layerIconGlyph} ${styles[`layerIconGlyph_${icon}`]}`}
          />
          <span className={styles.layerIconSpinner} />
        </span>
      </button>
      {showBadge && (
        <button
          type="button"
          className={styles.layerIconBadge}
          onClick={(e) => {
            e.stopPropagation();
            onBadgeClick?.();
          }}
          aria-label="Visa pågående olyckor"
        >
          {Math.min(badgeCount, 99)}
        </button>
      )}
    </span>
  );
}
