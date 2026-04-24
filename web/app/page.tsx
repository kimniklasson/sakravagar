import dynamic from "next/dynamic";
import styles from "./page.module.css";

const Map = dynamic(() => import("@/components/Map/Map"), { ssr: false });

export default function HomePage() {
  return (
    <main className={styles.main}>
      <Map />
    </main>
  );
}
