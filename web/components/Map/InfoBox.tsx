import { RoadOrXIcon } from "./MapIcons";
import styles from "./Map.module.css";

export function InfoBox({
  open,
  compact,
  onToggle,
  updatedText,
}: {
  open: boolean;
  compact: boolean;
  onToggle: () => void;
  updatedText: string;
}) {
  const compactClosed = compact && !open;
  const handleBoxClick = open ? undefined : onToggle;
  return (
    <div
      className={`${styles.infoBox} ${open ? styles.infoBoxOpen : ""} ${
        compactClosed ? styles.infoBoxCompact : ""
      }`}
      onClick={handleBoxClick}
      role={open ? "dialog" : "button"}
      tabIndex={open ? undefined : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={open}
      aria-label={open ? undefined : "Öppna kort information om tjänsten"}
    >
      <div className={styles.infoBoxHeader}>
        <img
          className={styles.infoBoxLogo}
          src="/logo/sakravagar_logo.svg"
          alt="Säkra vägar"
        />
        <button
          type="button"
          className={styles.infoBoxIconBtn}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={open ? "Stäng" : "Öppna"}
        >
          <RoadOrXIcon expanded={open} />
        </button>
      </div>
      <div
        className={`${styles.infoBoxIntroExpander} ${
          compactClosed ? "" : styles.infoBoxIntroExpanderOpen
        }`}
        aria-hidden={compactClosed}
      >
        <div className={styles.infoBoxIntroInner}>
          <h1 className={styles.infoBoxIntro}>
            Våga ut på vägarna. Hitta och jämför rutter som passar dig.
          </h1>
          <p className={styles.infoBoxUpdated}>{updatedText}</p>
        </div>
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <div className={styles.infoBoxBody}>
            <p>
              Känner du oro, rädsla, panik eller ångest i trafiken?{" "}
              Säkra vägar gör det tydligare vad en rutt innebär och vilka alternativ
              som finns. Målet är inte att lova en riskfri väg, utan att ge ett
              tryggare beslutsstöd när trafiken känns svår. Rutterna är stöd, inte
              garanti. Följ alltid skyltar och trafikregler, och använd inte appen
              aktivt medan du kör.
            </p>
            <p>
              Jag heter Kim och har själv haft ångest i trafiken. Har du frågor,
              feedback eller vill bidra till tjänsten får du gärna skriva till{" "}
              <a href="mailto:kontakt@sakravagar.se">kontakt@sakravagar.se</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
