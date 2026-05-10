"use client";

import styles from "./Map.module.css";

export type HelpSectionId = "accidents" | "traffic" | "disturbances" | "largeRoads";

type HelpLegendSwatch = {
  kind: "line" | "dot" | "pulse" | "square" | "triangle";
  color?: string;
};

type HelpLegendItem = {
  label: string;
  swatch: HelpLegendSwatch;
};

type HelpSectionIcon = "accidents" | "flow" | "disturbances" | "speed";

type HelpSection = {
  id: HelpSectionId;
  icon: HelpSectionIcon;
  title: string;
  body: string[];
  legend: HelpLegendItem[];
};

const helpSections: HelpSection[] = [
  {
    id: "accidents",
    icon: "accidents",
    title: "Olyckor",
    body: [
      "Här visas historiska olyckor som ljusa punkter och, om de finns just nu, pågående olyckor som live-markeringar.",
      "Lagret är tänkt som ett kontrollager. Det hjälper dig se mönster och aktuella händelser utan att göra en förenklad riskprognos.",
    ],
    legend: [
      { label: "Registrerad olycka", swatch: { kind: "dot", color: "#FFFFFF" } },
      { label: "Pågående olycka", swatch: { kind: "pulse", color: "#FFFFFF" } },
    ],
  },
  {
    id: "traffic",
    icon: "flow",
    title: "Trafikflöde",
    body: [
      "Lagret visar både genomsnittlig trafikmängd, ÅDT, från NVDB och liveflöde från Trafikverkets mätplatser där sådan data finns.",
      "ÅDT är inte live-data, utan en uppskattning av hur trafikerad vägen brukar vara. Liveflödet har bäst täckning i större trafikområden och gäller mätplatser med närliggande segment.",
    ],
    legend: [
      { label: "Lägre genomsnittligt flöde", swatch: { kind: "line", color: "#C2DEFF" } },
      { label: "Högre genomsnittligt flöde", swatch: { kind: "line", color: "#0077FF" } },
      { label: "Live: rullar på", swatch: { kind: "line", color: "#9FD86B" } },
      { label: "Live: tätare/långsam trafik", swatch: { kind: "line", color: "#FF7A3D" } },
    ],
  },
  {
    id: "disturbances",
    icon: "disturbances",
    title: "Trafikstörningar",
    body: [
      "Här visas pågående trafikstörningar från Trafikverket, till exempel vägarbeten, köer eller andra hinder.",
      "De används som kontrollager och visas också direkt på vald rutt när en föreslagen rutt passerar en pågående händelse.",
    ],
    legend: [
      { label: "Vägarbete", swatch: { kind: "triangle", color: "#999999" } },
      { label: "Trafikstörning eller kö", swatch: { kind: "triangle", color: "#999999" } },
    ],
  },
  {
    id: "largeRoads",
    icon: "speed",
    title: "Höga hastigheter",
    body: [
      "Lagret visar skyltade hastigheter 80 km/h och högre som diskreta badges. Linjerna lämnas till rutter, olyckor och trafikflöde, så du kan läsa hastigheten ovanpå en föreslagen rutt utan att kartan blir rörig.",
      "Det betyder inte att vägen är farlig, bara att körmiljön kan kännas mer intensiv. Lägre hastigheter visas inte i det här lagret.",
    ],
    legend: [],
  },
];

export function HelpPanel({
  open,
  activeSectionId,
  onSectionChange,
  onClose,
  updatedText,
  periodDays,
}: {
  open: boolean;
  activeSectionId: HelpSectionId | null;
  onSectionChange: (id: HelpSectionId | null) => void;
  onClose: () => void;
  updatedText: string;
  periodDays: number | null;
}) {
  const collectionText = periodDays
    ? `Historiska olyckor visas från de senaste ${periodDays.toLocaleString("sv-SE")} dagarna som finns i vår insamling.`
    : "Historiska olyckor visas från den datainsamling som finns tillgänglig just nu.";
  const dataUpdatedText = `Data ${updatedText.charAt(0).toLocaleLowerCase("sv-SE")}${updatedText.slice(1)}`;

  return (
    <aside
      className={`${styles.helpPanel} ${open ? styles.helpPanelOpen : ""}`}
      aria-hidden={!open}
      aria-label="Data och kartlager"
      inert={!open}
    >
      <button
        type="button"
        className={styles.helpPanelClose}
        onClick={onClose}
        aria-label="Stäng hjälp"
      >
        <span className={styles.helpPanelCloseIcon} aria-hidden="true" />
      </button>
      <div className={styles.helpPanelScroll}>
        <div className={styles.helpPanelHeader}>
          <p className={styles.helpPanelEyebrow}>Data och kartlager</p>
          <h2 className={styles.helpPanelTitle}>Få hjälp att förstå hur vi räknar ut och prioriterar våra ruttförslag.</h2>
        </div>
        <div className={styles.helpAccordion}>
          {helpSections.map((section) => {
            const expanded = activeSectionId === section.id;
            const panelId = `help-section-${section.id}`;
            return (
              <section className={styles.helpAccordionSection} key={section.id}>
                <button
                  type="button"
                  className={styles.helpAccordionButton}
                  onClick={() => onSectionChange(expanded ? null : section.id)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                >
                  <span
                    className={`${styles.layerIconGlyph} ${styles.helpSectionIcon} ${styles[`layerIconGlyph_${section.icon}`]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.helpAccordionTitle}>{section.title}</span>
                  <span
                    className={`${styles.helpAccordionIcon} ${
                      expanded ? styles.helpAccordionIconMinus : styles.helpAccordionIconPlus
                    }`}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={panelId}
                  className={`${styles.helpAccordionExpander} ${expanded ? styles.helpAccordionExpanderOpen : ""}`}
                >
                  <div className={styles.helpAccordionInner}>
                    {section.body.map((paragraph) => (
                      <p className={styles.helpParagraph} key={paragraph}>{paragraph}</p>
                    ))}
                    {section.legend.length > 0 && (
                      <ul className={styles.helpLegend}>
                        {section.legend.map((item) => (
                          <li key={`${section.id}-${item.label}`}>
                            <HelpLegendSwatch swatch={item.swatch} />
                            <span>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        <div className={styles.helpSources}>
          <p>
            Datakällor:{" "}
            <a href="https://api.trafikinfo.trafikverket.se/" target="_blank" rel="noreferrer">
              Trafikverket Open API
            </a>{" "}
            för olyckor, störningar och liveflöde. NVDB via{" "}
            <a href="https://lastkajen.trafikverket.se/" target="_blank" rel="noreferrer">
              Lastkajen
            </a>{" "}
            för trafikmängd och hastigheter.
          </p>
          <p>
            Olyckor, störningar och liveflöde hämtas från Trafikverket var 30:e minut.
            Kartan uppdaterar synliga lager ungefär varje minut medan sidan är öppen.
          </p>
          <p>
            {collectionText} Pågående olyckor räknas som live när de har setts inom de senaste 90 minuterna.
            Data är preliminär och bör ses som stöd, inte som enda underlag för vägval.
          </p>
          <p className={styles.helpSourcesUpdated}>{dataUpdatedText}</p>
        </div>
      </div>
    </aside>
  );
}

function HelpLegendSwatch({ swatch }: { swatch: HelpLegendSwatch }) {
  return (
    <span
      className={`${styles.helpLegendSwatch} ${styles[`helpLegendSwatch_${swatch.kind}`]}`}
      style={swatch.color ? { backgroundColor: swatch.color } : undefined}
      aria-hidden="true"
    />
  );
}
