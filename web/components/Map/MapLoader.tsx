"use client";

import dynamic from "next/dynamic";
import type { MapProps } from "./Map";

const Map = dynamic<MapProps>(() => import("./Map"), { ssr: false });

export default function MapLoader(props: MapProps) {
  return <Map {...props} />;
}
