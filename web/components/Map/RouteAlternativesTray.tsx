import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { RouteLine } from "@/app/api/route/route";
import styles from "./Map.module.css";
import {
  formatRouteDistance,
  formatRouteDuration,
  routeAlternativeCopy,
} from "./routeModel";
import type { RouteAvoidState } from "./routeModel";

type RouteNoticeCounts = {
  disturbances: number;
  liveAccidents: number;
  total: number;
};

function routeNoticeCounts(route: RouteLine): RouteNoticeCounts {
  const disturbances = route.annotations.disturbances?.length ?? 0;
  const liveAccidents = route.annotations.liveAccidents?.length ?? 0;
  return {
    disturbances,
    liveAccidents,
    total: disturbances + liveAccidents,
  };
}

function routeNoticeLabel(counts: RouteNoticeCounts): string {
  const parts: string[] = [];
  if (counts.disturbances > 0) {
    parts.push(`${counts.disturbances} ${counts.disturbances === 1 ? "störning" : "störningar"}`);
  }
  if (counts.liveAccidents > 0) {
    parts.push(`${counts.liveAccidents} ${counts.liveAccidents === 1 ? "olycka" : "olyckor"}`);
  }
  return parts.length ? `Pågår: ${parts.join(" och ")}` : "";
}

export function RouteAlternativesTray({
  routes,
  baselineRoute,
  routeAvoids,
  selectedRouteId,
  isCustomRoute,
  revealSelectedRouteRef,
  onSelectRoute,
  onPreviewRoute,
  onCopyRouteUrl,
  onOpenRouteInGoogleMaps,
  onSubmitRouteFeedback,
  onUpdateRouteFeedbackComment,
  onClearRouteFeedback,
}: {
  routes: RouteLine[];
  baselineRoute: RouteLine | null;
  routeAvoids: RouteAvoidState;
  selectedRouteId: string | null;
  isCustomRoute: boolean;
  revealSelectedRouteRef: MutableRefObject<boolean>;
  onSelectRoute: (routeId: string) => void;
  onPreviewRoute: (routeId: string | null) => void;
  onCopyRouteUrl: (routeId: string) => Promise<void>;
  onOpenRouteInGoogleMaps: (routeId: string) => void;
  onSubmitRouteFeedback: (routeId: string, vote: "up" | "down", comment: string) => Promise<string>;
  onUpdateRouteFeedbackComment: (feedbackId: string, comment: string) => Promise<void>;
  onClearRouteFeedback: (feedbackId: string) => Promise<void>;
}) {
  const routeAlternativesRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    scrollLeft: number;
    captured: boolean;
  } | null>(null);
  const wasDraggingRef = useRef(false);
  const feedbackRegionRef = useRef<HTMLDivElement | null>(null);
  const feedbackPopoverRef = useRef<HTMLFormElement | null>(null);
  const feedbackInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);
  const [copyingRouteId, setCopyingRouteId] = useState<string | null>(null);
  const [copyErrorRouteId, setCopyErrorRouteId] = useState<string | null>(null);
  const [noticeTooltip, setNoticeTooltip] = useState<{
    label: string;
    left: number;
    top: number;
  } | null>(null);
  const [routeFeedbackByRoute, setRouteFeedbackByRoute] = useState<Record<string, {
    vote: "up" | "down";
    feedbackId: string | null;
    pending: boolean;
    error: string | null;
  }>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<{
    routeId: string;
    vote: "up" | "down";
    comment: string;
    submitting: boolean;
    error: string | null;
    anchor: { right: number; bottom: number };
  } | null>(null);
  const feedbackFocusKey = feedbackDraft ? `${feedbackDraft.routeId}:${feedbackDraft.vote}` : null;

  const feedbackAnchorFromButton = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    return {
      right: Math.max(16, window.innerWidth - rect.right - 14),
      bottom: Math.max(16, window.innerHeight - rect.top + 18),
    };
  };

  const showNoticeTooltip = (element: HTMLElement, label: string) => {
    const rect = element.getBoundingClientRect();
    const halfWidth = 112;
    setNoticeTooltip({
      label,
      left: Math.min(window.innerWidth - halfWidth, Math.max(halfWidth, rect.left + rect.width / 2)),
      top: Math.max(12, rect.top - 10),
    });
  };

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

  useEffect(() => {
    if (!copiedRouteId && !copyErrorRouteId) return;
    const id = window.setTimeout(() => {
      setCopiedRouteId(null);
      setCopyErrorRouteId(null);
    }, 2200);
    return () => window.clearTimeout(id);
  }, [copiedRouteId, copyErrorRouteId]);

  useEffect(() => {
    if (!feedbackFocusKey) return;
    const id = window.setTimeout(() => feedbackInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [feedbackFocusKey]);

  useEffect(() => {
    if (!feedbackDraft) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && feedbackRegionRef.current?.contains(target)) return;
      if (target instanceof Node && feedbackPopoverRef.current?.contains(target)) return;
      setFeedbackDraft(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [feedbackDraft]);

  const handleRouteFeedbackClick = async (
    routeId: string,
    vote: "up" | "down",
    button: HTMLButtonElement,
  ) => {
    const current = routeFeedbackByRoute[routeId] ?? null;

    if (current?.vote === vote) {
      setFeedbackDraft(null);
      setRouteFeedbackByRoute((byRoute) => {
        const next = { ...byRoute };
        delete next[routeId];
        return next;
      });
      if (current.feedbackId) {
        try {
          await onClearRouteFeedback(current.feedbackId);
        } catch (err) {
          console.warn("route feedback delete failed", err);
          setRouteFeedbackByRoute((byRoute) => ({
            ...byRoute,
            [routeId]: { ...current, error: "Kunde inte ta bort." },
          }));
        }
      }
      return;
    }

    const anchor = feedbackAnchorFromButton(button);
    setRouteFeedbackByRoute((byRoute) => ({
      ...byRoute,
      [routeId]: {
        vote,
        feedbackId: null,
        pending: true,
        error: null,
      },
    }));
    setFeedbackDraft({
      routeId,
      vote,
      comment: "",
      submitting: false,
      error: null,
      anchor,
    });

    try {
      if (current?.feedbackId) await onClearRouteFeedback(current.feedbackId);
      const feedbackId = await onSubmitRouteFeedback(routeId, vote, "");
      setRouteFeedbackByRoute((byRoute) => ({
        ...byRoute,
        [routeId]: {
          vote,
          feedbackId,
          pending: false,
          error: null,
        },
      }));
    } catch (err) {
      console.warn("route feedback save failed", err);
      setRouteFeedbackByRoute((byRoute) => ({
        ...byRoute,
        [routeId]: {
          vote,
          feedbackId: null,
          pending: false,
          error: "Kunde inte spara.",
        },
      }));
      setFeedbackDraft((currentDraft) => currentDraft?.routeId === routeId
        ? { ...currentDraft, error: "Kunde inte spara." }
        : currentDraft);
    }
  };

  const submitFeedbackComment = async () => {
    if (!feedbackDraft) return;

    setFeedbackDraft((current) => current ? { ...current, submitting: true, error: null } : current);
    try {
      const currentFeedback = routeFeedbackByRoute[feedbackDraft.routeId];
      const feedbackId = currentFeedback?.feedbackId
        ? currentFeedback.feedbackId
        : await onSubmitRouteFeedback(feedbackDraft.routeId, feedbackDraft.vote, "");
      await onUpdateRouteFeedbackComment(feedbackId, feedbackDraft.comment);
      setRouteFeedbackByRoute((byRoute) => ({
        ...byRoute,
        [feedbackDraft.routeId]: {
          vote: feedbackDraft.vote,
          feedbackId,
          pending: false,
          error: null,
        },
      }));
      setFeedbackDraft(null);
    } catch (err) {
      console.warn("route feedback comment failed", err);
      setFeedbackDraft((current) => current ? {
        ...current,
        submitting: false,
        error: "Kunde inte spara.",
      } : current);
    }
  };

  if (routes.length === 0) return null;

  return (
    <>
    <div
      ref={routeAlternativesRef}
      className={styles.routeAlternatives}
      aria-live="polite"
      onScroll={() => setNoticeTooltip(null)}
      onWheel={(e) => {
        setNoticeTooltip(null);
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        e.currentTarget.scrollLeft += delta;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setNoticeTooltip(null);
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
        const noticeCounts = routeNoticeCounts(route);
        const noticeLabel = routeNoticeLabel(noticeCounts);
        const routeFeedback = routeFeedbackByRoute[route.id] ?? null;
        const feedbackVote = routeFeedback?.vote ?? null;
        const copyTooltip =
          copiedRouteId === route.id
            ? "Kopierad"
            : copyErrorRouteId === route.id
              ? "Kunde inte kopiera"
              : copyingRouteId === route.id
                ? "Skapar länk..."
                : "Kopiera URL";
        return (
          <div
            key={route.id}
            data-route-id={route.id}
            className={`${styles.routeAlternativeCard} ${selected ? styles.routeAlternativeCardSelected : ""}`}
            style={{ animationDelay: `${index * 70}ms` }}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if (wasDraggingRef.current) {
                e.preventDefault();
                wasDraggingRef.current = false;
                return;
              }
              onSelectRoute(route.id);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
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
              <span className={styles.routeAlternativeDistanceGroup}>
                <span className={styles.routeAlternativeDistance}>
                  {formatRouteDistance(route.distanceMeters)}
                </span>
                {noticeCounts.total > 0 && (
                  <span
                    className={styles.routeAlternativeNoticeIcon}
                    aria-label={noticeLabel}
                    onPointerEnter={(event) => showNoticeTooltip(event.currentTarget, noticeLabel)}
                    onPointerLeave={() => setNoticeTooltip(null)}
                    role="img"
                  >
                    <img
                      className={styles.routeAlternativeNoticeIconImage}
                      src="/icons/varning_rund.svg"
                      alt=""
                      aria-hidden="true"
                    />
                  </span>
                )}
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
            <div
              ref={feedbackDraft?.routeId === route.id ? feedbackRegionRef : undefined}
              className={styles.routeAlternativeActions}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`${styles.routeActionBtn} ${
                  copiedRouteId === route.id ? styles.routeActionBtnCopied : ""
                } ${copiedRouteId === route.id || copyErrorRouteId === route.id ? styles.routeActionTooltipVisible : ""}`}
                onClick={async () => {
                  setCopyingRouteId(route.id);
                  setCopyErrorRouteId(null);
                  try {
                    await onCopyRouteUrl(route.id);
                    setCopiedRouteId(route.id);
                  } catch (err) {
                    console.warn("route copy failed", err);
                    setCopyErrorRouteId(route.id);
                  } finally {
                    setCopyingRouteId(null);
                  }
                }}
                aria-label="Kopiera URL"
                data-tooltip={copyTooltip}
                disabled={copyingRouteId === route.id}
              >
                <span
                  className={`${styles.routeActionGlyph} ${styles.routeActionGlyph_copy}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                className={`${styles.routeActionTextBtn} ${styles.routeActionBtn}`}
                onClick={() => onOpenRouteInGoogleMaps(route.id)}
                aria-label="Visa den här rutten i Google Maps"
                data-tooltip="Visa den här rutten i Google Maps"
              >
                Visa i Google Maps
              </button>
              <span className={styles.routeFeedbackActions}>
                <button
                  type="button"
                  className={`${styles.routeActionBtn} ${
                    feedbackVote === "down" ? styles.routeActionBtnBad : ""
                  }`}
                  onClick={(event) => {
                    void handleRouteFeedbackClick(route.id, "down", event.currentTarget);
                  }}
                  aria-label="Sämre rutt"
                  aria-pressed={feedbackVote === "down"}
                  data-tooltip="Sämre rutt"
                >
                  <span
                    className={`${styles.routeActionGlyph} ${styles.routeActionGlyph_thumbdown}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={`${styles.routeActionBtn} ${
                    feedbackVote === "up" ? styles.routeActionBtnGood : ""
                  }`}
                  onClick={(event) => {
                    void handleRouteFeedbackClick(route.id, "up", event.currentTarget);
                  }}
                  aria-label="Bra rutt"
                  aria-pressed={feedbackVote === "up"}
                  data-tooltip="Bra rutt"
                >
                  <span
                    className={`${styles.routeActionGlyph} ${styles.routeActionGlyph_thumbup}`}
                    aria-hidden="true"
                  />
                </button>
              </span>
            </div>
          </div>
        );
      })}
    </div>
    {noticeTooltip && typeof document !== "undefined" && createPortal(
      <div
        className={styles.routeAlternativeNoticeTooltip}
        style={{
          left: `${noticeTooltip.left}px`,
          top: `${noticeTooltip.top}px`,
        }}
        role="tooltip"
      >
        {noticeTooltip.label}
      </div>,
      document.body,
    )}
    {feedbackDraft && typeof document !== "undefined" && createPortal(
      <form
        ref={feedbackPopoverRef}
        className={styles.routeFeedbackPopover}
        style={{
          right: `${feedbackDraft.anchor.right}px`,
          bottom: `${feedbackDraft.anchor.bottom}px`,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submitFeedbackComment();
        }}
      >
        <div className={styles.routeFeedbackHeader}>
          <span>Feedback</span>
          <button
            type="button"
            className={styles.routeFeedbackClose}
            onClick={() => setFeedbackDraft(null)}
            aria-label="Stäng feedback"
          />
        </div>
        <textarea
          ref={feedbackInputRef}
          className={styles.routeFeedbackInput}
          value={feedbackDraft.comment}
          maxLength={200}
          rows={2}
          placeholder={feedbackDraft.vote === "down" ? "Varför var den inte bra?" : "Varför var den bra?"}
          onChange={(event) => {
            const next = event.target.value.slice(0, 200);
            setFeedbackDraft((current) => current ? { ...current, comment: next } : current);
          }}
        />
        <button
          type="submit"
          className={styles.routeFeedbackSubmit}
          disabled={feedbackDraft.submitting || routeFeedbackByRoute[feedbackDraft.routeId]?.pending}
        >
          {feedbackDraft.submitting || routeFeedbackByRoute[feedbackDraft.routeId]?.pending ? (
            <span className={styles.routeFeedbackSpinner} aria-label="Sparar feedback" />
          ) : (
            "Skicka"
          )}
        </button>
        {(feedbackDraft.error || routeFeedbackByRoute[feedbackDraft.routeId]?.error) && (
          <div className={styles.routeFeedbackError} role="status">
            {feedbackDraft.error ?? routeFeedbackByRoute[feedbackDraft.routeId]?.error}
          </div>
        )}
      </form>,
      document.body,
    )}
    </>
  );
}
