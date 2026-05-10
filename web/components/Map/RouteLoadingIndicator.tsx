"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./Map.module.css";

const routeLoadingMessages = [
  "Mäter distanser...",
  "Räknar vägar...",
  "Hittar alternativ...",
  "Väger vägval...",
  "Letar lugnare sträckor...",
  "Jämför vägval...",
  "Kollar störningar...",
  "Undviker omvägar...",
  "Synkar kartan...",
  "Finjusterar rutten...",
];

export type RouteLoadingMode = "fastest" | "filtered";

const routeLoadingHints: Record<RouteLoadingMode, Array<{ afterMs: number; text: string }>> = {
  fastest: [
    {
      afterMs: 4_000,
      text: "Det tar längre tid än vanligt. Vi hämtar snabbaste vägen.",
    },
    {
      afterMs: 12_000,
      text: "Det tar ovanligt lång tid att hitta rutten. Prova igen om det inte släpper.",
    },
  ],
  filtered: [
    {
      afterMs: 12_000,
      text: "Det här tar längre tid än vanligt. Vi jämför flera lugnare vägar.",
    },
    {
      afterMs: 30_000,
      text: "Det tar ovanligt lång tid att hitta bra alternativ. Kortare resa eller färre undvik-val går ofta snabbare.",
    },
  ],
};

function shuffledRouteLoadingMessages(): string[] {
  return routeLoadingMessages
    .map((message) => ({ message, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ message }) => message);
}

export function RouteLoadingIndicator({
  active,
  mode,
}: {
  active: boolean;
  mode: RouteLoadingMode;
}) {
  const [messages, setMessages] = useState(shuffledRouteLoadingMessages);
  const [messageIndex, setMessageIndex] = useState(0);
  const [hintText, setHintText] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setMessages(shuffledRouteLoadingMessages());
    setMessageIndex(0);
    setHintText(null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setMessageIndex((index) => (index + 1) % messages.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [active, messages.length]);

  useEffect(() => {
    if (!active) {
      setHintText(null);
      return;
    }

    setHintText(null);
    const timers = routeLoadingHints[mode].map((hint) =>
      window.setTimeout(() => setHintText(hint.text), hint.afterMs),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [active, mode]);

  return (
    <div className={styles.routeLoadingIndicator}>
      <div className={styles.routeLoadingRuler} aria-hidden="true">
        <span className={styles.routeLoadingRulerBase} />
        <span className={styles.routeLoadingRulerSweep} />
      </div>
      <div
        className={styles.routeLoadingMessageMask}
        style={{ "--route-loading-message-index": messageIndex } as CSSProperties}
      >
        <div className={styles.routeLoadingMessageStack}>
          {messages.map((message) => (
            <span key={message} className={styles.routeLoadingMessage}>
              {message}
            </span>
          ))}
        </div>
      </div>
      {hintText && <div className={styles.routeLoadingHint}>{hintText}</div>}
    </div>
  );
}
