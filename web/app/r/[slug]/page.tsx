import styles from "../../page.module.css";
import MapLoader from "@/components/Map/MapLoader";

export default async function SharedRoutePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main className={styles.main}>
      <MapLoader sharedRouteSlug={slug} />
    </main>
  );
}
