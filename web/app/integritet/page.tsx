import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Integritet och kakor – Säkra vägar",
  description:
    "Information om hur Säkra vägar behandlar personuppgifter, platsdata, rutter, analysdata och kakor.",
  alternates: {
    canonical: "/integritet",
  },
};

const updatedAt = "15 maj 2026";

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            Tillbaka till kartan
          </Link>
          <p className={styles.eyebrow}>Integritet</p>
          <h1>Integritet och kakor</h1>
          <p className={styles.lead}>
            Den här sidan beskriver hur Säkra vägar behandlar uppgifter när du använder
            kartan, söker adresser, räknar rutter, delar en rutt eller lämnar feedback.
          </p>
          <p className={styles.updated}>Senast uppdaterad: {updatedAt}</p>
        </header>

        <section className={styles.section}>
          <h2>Kort version</h2>
          <p>
            Vi använder inga egna icke-nödvändiga kakor för spårning och har därför
            ingen cookie-banner. Vi använder Vercel Web Analytics, som enligt Vercel
            inte använder kakor och bara sparar anonymiserad statistik.
          </p>
          <p>
            Däremot behandlas vissa uppgifter för att tjänsten ska fungera: IP-adress
            för säkerhet och begränsning av missbruk, adress- och koordinatsökningar
            för geokodning och ruttberäkning, samt ruttdata om du själv skapar en
            delningslänk eller lämnar feedback.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Personuppgiftsansvarig och kontakt</h2>
          <p>
            Personuppgiftsansvarig för behandlingen på sakravagar.se är den som driver
            tjänsten Säkra vägar. För frågor om integritet eller för att utöva dina
            rättigheter kan du kontakta oss på{" "}
            <a href="mailto:kontakt@sakravagar.se">kontakt@sakravagar.se</a>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Uppgifter som behandlas</h2>
          <dl className={styles.definitionList}>
            <div>
              <dt>När du besöker webbplatsen</dt>
              <dd>
                Vercel och våra serverloggar kan behandla tekniska uppgifter som IP-adress,
                tidpunkt, URL, webbläsare, enhetstyp och ungefärlig region. Vi använder detta
                för drift, felsökning, säkerhet och anonymiserad besöksstatistik.
              </dd>
            </div>
            <div>
              <dt>När kartan laddas</dt>
              <dd>
                Kartan hämtar kartdata, typsnitt och ikoner från OpenFreeMap. Sådana
                anrop kan innebära att OpenFreeMap tar emot tekniska uppgifter som
                IP-adress och vilka karttile-filer som efterfrågas.
              </dd>
            </div>
            <div>
              <dt>När du söker en adress</dt>
              <dd>
                Söktexten skickas till vårt geokodnings-API och vidare till Nominatim
                från OpenStreetMap. Resultat cacheas kortvarigt i serverminne för att
                tjänsten ska vara snabbare och belasta geokodningstjänsten mindre.
              </dd>
            </div>
            <div>
              <dt>När du använder din position</dt>
              <dd>
                Position används bara om du trycker på platsknappen och godkänner
                webbläsarens fråga. Koordinaterna används för att visa din position
                eller fylla i ett ruttstopp, och kan då skickas till geokodning för
                att visa en läsbar plats.
              </dd>
            </div>
            <div>
              <dt>När du räknar en rutt</dt>
              <dd>
                Ruttens koordinater skickas till vårt routing-API och vidare till vår
                routingmotor på routing.sakravagar.se. Om den inte är tillgänglig kan
                OSRM användas som reserv. Våra egna ruttloggar är avsedda att innehålla
                mätvärden, inte adresser eller koordinater.
              </dd>
            </div>
            <div>
              <dt>När du delar en rutt</dt>
              <dd>
                Om du skapar en delningslänk sparas en rutt-snapshot med stopp,
                koordinater, vald rutt och ruttinställningar i Supabase. Länken är
                publik för alla som har URL:en och sparas i upp till 30 dagar.
              </dd>
            </div>
            <div>
              <dt>När du lämnar feedback</dt>
              <dd>
                Om du röstar på en rutt sparas din röst, teknisk ruttmetadata och en
                privat rutt-snapshot i Supabase i upp till 90 dagar. Det hjälper oss
                förstå vilka rutter som känns användbara.
              </dd>
            </div>
            <div>
              <dt>När du öppnar rutten i Google Maps</dt>
              <dd>
                Om du väljer att öppna en rutt i Google Maps skickas start, mål och
                eventuella vägpunkter till Google via länken. Googles egen hantering
                gäller därefter.
              </dd>
            </div>
          </dl>
        </section>

        <section className={styles.section}>
          <h2>Varför uppgifterna behandlas</h2>
          <p>
            Adressökning, platsfunktion, ruttberäkning och delningslänkar behandlas
            för att utföra det du ber tjänsten göra. Tekniska uppgifter, rate limiting,
            loggar och anonymiserad statistik behandlas för drift, säkerhet, felsökning
            och för att förbättra tjänsten.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Kakor och liknande teknik</h2>
          <p>
            Säkra vägar använder inte egna spårningskakor och sätter inte icke-nödvändiga
            kakor för annonsering eller profilering. Vercel Web Analytics används utan
            kakor. Om vi senare lägger till en tjänst som kräver samtycke, till exempel
            annonsmätning eller tredjepartsspårning, ska den inte laddas innan du har
            fått välja.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Mottagare och leverantörer</h2>
          <ul className={styles.list}>
            <li>Vercel för hosting, driftloggar och cookielös webbanalys.</li>
            <li>Supabase för databas och lagring av rutt-snapshots och feedback.</li>
            <li>Nominatim/OpenStreetMap för adressökning och reverse geocoding.</li>
            <li>OpenFreeMap för karttiles, typsnitt och kartikoner.</li>
            <li>Hetzner/routing.sakravagar.se för vår self-hostade routingmotor.</li>
            <li>OSRM som möjlig reserv för ruttberäkning.</li>
            <li>Google Maps endast när du själv väljer att öppna rutten där.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Lagringstid</h2>
          <ul className={styles.list}>
            <li>Geokodningsresultat cacheas i serverminne i upp till 24 timmar.</li>
            <li>Publika delningslänkar sparas i upp till 30 dagar.</li>
            <li>Feedback och privata rutt-snapshots sparas i upp till 90 dagar.</li>
            <li>Driftloggar och analysdata sparas enligt respektive leverantörs rutiner.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Dina rättigheter</h2>
          <p>
            Du kan be om information om personuppgifter vi behandlar om dig, begära
            rättelse eller radering, invända mot viss behandling och begära begränsning.
            Du kan också klaga hos Integritetsskyddsmyndigheten, IMY.
          </p>
          <p>
            För att kunna hitta uppgifter kopplade till en delningslänk eller feedback
            kan vi behöva att du skickar med länken eller feedback-id:t.
          </p>
        </section>
      </div>
    </main>
  );
}
