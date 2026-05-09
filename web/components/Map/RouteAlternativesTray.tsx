import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { RouteLine } from "@/app/api/route/route";
import styles from "./Map.module.css";
import {
  formatRouteDistance,
  formatRouteDuration,
  routeAlternativeCopy,
} from "./routeModel";
import type { RouteAvoidState } from "./routeModel";

export function RouteAlternativesTray({
  routes,
  baselineRoute,
  routeAvoids,
  selectedRouteId,
  isCustomRoute,
  revealSelectedRouteRef,
  onSelectRoute,
  onPreviewRoute,
}: {
  routes: RouteLine[];
  baselineRoute: RouteLine | null;
  routeAvoids: RouteAvoidState;
  selectedRouteId: string | null;
  isCustomRoute: boolean;
  revealSelectedRouteRef: MutableRefObject<boolean>;
  onSelectRoute: (routeId: string) => void;
  onPreviewRoute: (routeId: string | null) => void;
}) {
  const routeAlternativesRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    scrollLeft: number;
    captured: boolean;
  } | null>(null);
  const wasDraggingRef = useRef(false);

  useLayoutEffect(() => {
    if (!selectedRouteId || !revealSelectedRouteRef.current) return;
    revealSelectedRouteRef.current = false;

    const selected = routeAlternativesRef.current?.querySelector<HTMLElement>(
      `[data-route-id="${CSS.escape(selectedRouteId)}"]`,
    );
    const tray = routeAlternativesRef.current;
    if (!selected || !tray) return;

    const targetLeft = selected.offsetLeft - (tray.clientWidth - selected.offsetWidth) / 2;
    tray.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth",
    });
  }, [routes, selectedRouteId, revealSelectedRouteRef]);

  useLayoutEffect(() => {
    const element = routeAlternativesRef.current;
    if (!element) return;

    const update = () => {
      document.documentElement.style.setProperty("--route-results-height", `${element.offsetHeight}px`);
      document.documentElement.style.setProperty(
        "--route-results-loader-bottom",
        `calc(max(32px, calc(var(--app-visual-bottom, 0px) + 32px)) + env(safe-area-inset-bottom) + ${element.offsetHeight}px)`,
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--route-results-height");
      document.documentElement.style.removeProperty("--route-results-loader-bottom");
    };
  }, [routes]);

  if (routes.length === 0) return null;

  return (
    <div
      ref={routeAlternativesRef}
      className={styles.routeAlternatives}
      aria-live="polite"
      onWheel={(e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        e.currentTarget.scrollLeft += delta;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          scrollLeft: e.currentTarget.scrollLeft,
          captured: false,
        };
        wasDraggingRef.current = false;
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const deltaX = e.clientX - drag.startX;
        if (Math.abs(deltaX) > 8) {
          wasDraggingRef.current = true;
          if (!drag.captured) {
            e.currentTarget.setPointerCapture(drag.pointerId);
            drag.captured = true;
          }
        }
        e.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.captured && e.currentTarget.hasPointerCapture(drag.pointerId)) {
          e.currentTarget.releasePointerCapture(drag.pointerId);
        }
      }}
      onPointerCancel={(e) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.captured && e.currentTarget.hasPointerCapture(drag.pointerId)) {
          e.currentTarget.releasePointerCapture(drag.pointerId);
        }
      }}
    >
      {routes.map((route, index) => {
        const copy = routeAlternativeCopy(route, index, baselineRoute, routeAvoids, routes, isCustomRoute);
        const selected = route.id === selectedRouteId;
        return (
          <button
            key={route.id}
            type="button"
            data-route-id={route.id}
            className={`${styles.routeAlternativeCard} ${selected ? styles.routeAlternativeCardSelected : ""}`}
            style={{ animationDelay: `${index * 70}ms` }}
            onClick={(e) => {
              if (wasDraggingRef.current) {
                e.preventDefault();
                wasDraggingRef.current = false;
                return;
              }
              onSelectRoute(route.id);
            }}
            onMouseEnter={() => onPreviewRoute(route.id)}
            onMouseLeave={() => onPreviewRoute(null)}
            onFocus={() => onPreviewRoute(route.id)}
            onBlur={() => onPreviewRoute(null)}
            aria-pressed={selected}
          >
            <span className={styles.routeAlternativeTop}>
              <span className={styles.routeAlternativeTitle}>{copy.title}</span>
              <span className={styles.routeAlternativeDistance}>
                {formatRouteDistance(route.distanceMeters)}
              </span>
            </span>
            <span className={styles.routeAlternativeTime}>
              {formatRouteDuration(route.durationSeconds)}
            </span>
            {copy.rows.length > 0 && (
              <span className={styles.routeAlternativeMetrics}>
                {copy.rows.map((row) => (
                  <span className={styles.routeAlternativeMetricRow} key={row.label}>
                    <span className={styles.routeAlternativeMetricLabelGroup}>
                      <span
                        className={`${styles.routeAlternativeMetricIcon} ${
                          styles[`routeAlternativeMetricIcon_${row.kind}`]
                        } ${row.tone === "muted" ? styles.routeAlternativeMetricIconMuted : ""}`}
                        aria-hidden="true"
                      />
                      <span className={styles.routeAlternativeMetricLabel}>{row.label}</span>
                    </span>
                    <span
                      className={`${styles.routeAlternativeMetricValue} ${
                        row.tone === "positive" ? styles.routeAlternativeMetricValuePositive : ""
                      } ${row.tone === "muted" ? styles.routeAlternativeMetricValueMuted : ""
                      }`}
                    >
                      {row.value}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
