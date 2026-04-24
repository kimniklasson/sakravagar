import styles from "./page.module.css";
import MapLoader from "@/components/Map/MapLoader";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <MapLoader />
    </main>
  );
}
