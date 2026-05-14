"use client";

import styles from "./HelpPanel.module.css";

export type HelpSectionId =
  | "routeHighSpeed"
  | "routeTrafficIntensity"
  | "routeCityTraffic"
  | "routeBridges"
  | "routeTunnels"
  | "accidents"
  | "traffic"
  | "disturbances"
  | "largeRoads";

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
  icon?: HelpSectionIcon;
  title: string;
  body: string[];
  legend: HelpLegendItem[];
};

const routeHelpSections: HelpSection[] = [
  {
    id: "routeHighSpeed",
    title: "Höga hastigheter",
    body: [
      "När du väljer det här försöker ruttplaneraren hitta alternativ med mindre körning på vägar i 90 km/h och uppåt.",
      "Det kan ge en lugnare körkänsla, även när den snabbaste vägen fortfarande finns kvar som jämförelse.",
    ],
    legend: [],
  },
  {
    id: "routeTrafficIntensity",
    title: "Trafikintensiva vägar",
    body: [
      "Vi letar efter vägar som brukar bära mindre trafik, och väger in liveflöde där sådan information finns.",
      "Valet är till för dig som hellre tar en mer överskådlig sträcka än hamnar i de mest trafikerade miljöerna.",
    ],
    legend: [],
  },
  {
    id: "routeCityTraffic",
    title: "Stadstrafik",
    body: [
      "Här försöker vi minska körning genom tät stadsmiljö och större urbana leder när det finns rimliga alternativ.",
      "Det passar när du vill ha färre start, stopp, filbyten och intensiva korsningar längs vägen.",
    ],
    legend: [],
  },
  {
    id: "routeBridges",
    title: "Broar",
    body: [
      "Vi prioriterar rutter med färre broar eller kortare brosträckor när vägnätet ger oss ett bra alternativ.",
      "I vissa lägen går broar inte att undvika helt, men då försöker vi visa det lugnaste rimliga valet.",
    ],
    legend: [],
  },
  {
    id: "routeTunnels",
    title: "Tunnlar",
    body: [
      "Vi letar efter rutter med färre tunnlar eller mindre tid i tunnel när det går att göra utan en orimlig omväg.",
      "Om tunnlar behövs för att resan ska fungera hjälper jämförelsen dig se vilket alternativ som innebär minst tunnelkörning.",
    ],
    legend: [],
  },
];

const layerHelpSections: HelpSection[] = [
  {
    id: "accidents",
    icon: "accidents",
    title: "Olyckor",
    body: [
      "Se var olyckor har inträffat tidigare, och om något händer just nu längs vägen.",
      "Lagret ger en lugnare överblick inför ditt vägval, utan att försöka säga att en viss väg är trygg eller otrygg.",
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
      "Få en känsla för hur mycket trafik en väg brukar bära, och var trafiken rör sig långsammare just nu.",
      "Liveflödet finns i dagsläget främst runt Stockholm och Göteborg. På andra platser hjälper lagret dig ändå att se vilka vägar som brukar vara mer eller mindre trafikerade.",
      "Det hjälper dig välja sträckor som känns mer överskådliga, särskilt om du vill undvika de mest intensiva trafikmiljöerna.",
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
      "Se sådant som kan påverka resan just nu, som vägarbeten, köer eller hinder längs vägen.",
      "När en vald rutt passerar en pågående händelse lyfter vi fram den direkt, så att du kan förbereda dig innan du kör.",
    ],
    legend: [
      { label: "Vägarbete, störning eller kö", swatch: { kind: "triangle", color: "#999999" } },
    ],
  },
  {
    id: "largeRoads",
    icon: "speed",
    title: "Höga hastigheter",
    body: [
      "Se var körningen kan kännas mer snabb och intensiv, med skyltade hastigheter från 80 km/h och uppåt.",
      "Märkningen ligger diskret ovanpå kartan så att du kan väga in hastigheten utan att den tar över rutt, olyckor eller trafikflöde.",
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
        <HelpPanelGroup
          eyebrow="Våra ruttförslag"
          title="Hur vi väger lugnare vägar mot restid."
          sections={routeHelpSections}
          activeSectionId={activeSectionId}
          onSectionChange={onSectionChange}
          showIcons={false}
        />
        <HelpPanelGroup
          eyebrow="Data och kartlager"
          title="Vad kartlagren visar och hur du kan läsa dem."
          sections={layerHelpSections}
          activeSectionId={activeSectionId}
          onSectionChange={onSectionChange}
        />
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

function HelpPanelGroup({
  eyebrow,
  title,
  sections,
  activeSectionId,
  onSectionChange,
  showIcons = true,
}: {
  eyebrow: string;
  title: string;
  sections: HelpSection[];
  activeSectionId: HelpSectionId | null;
  onSectionChange: (id: HelpSectionId | null) => void;
  showIcons?: boolean;
}) {
  return (
    <section className={`${styles.helpPanelGroup} ${showIcons ? "" : styles.helpPanelGroupNoIcons}`}>
      <div className={styles.helpPanelHeader}>
        <p className={styles.helpPanelEyebrow}>{eyebrow}</p>
        <h2 className={styles.helpPanelTitle}>{title}</h2>
      </div>
      <div className={styles.helpAccordion}>
        {sections.map((section) => {
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
                {showIcons && section.icon && (
                  <span
                    className={`${styles.layerIconGlyph} ${styles.helpSectionIcon} ${styles[`layerIconGlyph_${section.icon}`]}`}
                    aria-hidden="true"
                  />
                )}
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
    </section>
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
