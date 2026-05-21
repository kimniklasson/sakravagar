"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GeocodeResult } from "@/app/api/geocode/route";
import { LocationIcon, WarningIcon } from "./MapIcons";
import styles from "./RoutePlannerBox.module.css";
import {
  isCustomRouteStop,
  routeAvoidLabels,
  routeAvoidTooltips,
} from "./routeModel";
import type { RouteAvoidOption, RouteAvoidState, RouteStop } from "./routeModel";

export function RoutePlannerBox({
  stops,
  activeStopId,
  loadingStopId,
  geocodingStopId,
  geocodeResultsByStop,
  routeError,
  routeNoticeText,
  routeAvoids,
  onFocusStop,
  onDeactivate,
  onChangeStop,
  onClearStop,
  onSelectGeocode,
  onUsePosition,
  onToggleAvoid,
  onDragStartStop,
  onDropStop,
}: {
  stops: RouteStop[];
  activeStopId: string | null;
  loadingStopId: string | null;
  geocodingStopId: string | null;
  geocodeResultsByStop: Record<string, GeocodeResult[]>;
  routeError: string | null;
  routeNoticeText: string | null;
  routeAvoids: RouteAvoidState;
  onFocusStop: (id: string) => void;
  onDeactivate: () => void;
  onChangeStop: (id: string, label: string) => void;
  onClearStop: (id: string) => void;
  onSelectGeocode: (id: string, result: GeocodeResult) => void;
  onUsePosition: (id: string) => void;
  onToggleAvoid: (option: RouteAvoidOption) => void;
  onDragStartStop: (id: string) => void;
  onDropStop: (id: string) => void;
}) {
  const visibleStops = stops;
  const activeStop = visibleStops.find((stop) => stop.id === activeStopId) ?? null;
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const firstRouteInputRef = useRef<HTMLInputElement | null>(null);
  const initialFocusDoneRef = useRef(false);

  const activeStopLoading = activeStop
    ? loadingStopId === activeStop.id || geocodingStopId === activeStop.id
    : false;
  const activeSuggestions = activeStop ? geocodeResultsByStop[activeStop.id] ?? [] : [];
  const activeShowsPositionSuggestion = Boolean(
    activeStop && activeStop.id === stops[0]?.id && !activeStop.label,
  );
  const activeSuggestionCount = activeSuggestions.length + (activeShowsPositionSuggestion ? 1 : 0);

  useEffect(() => {
    setActiveSuggestionIndex(null);
  }, [activeStopId, activeStop?.label, activeSuggestionCount]);

  useEffect(() => {
    if (initialFocusDoneRef.current) return;

    const firstRouteInput = firstRouteInputRef.current;
    if (!firstRouteInput) return;

    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement
    ) {
      return;
    }

    initialFocusDoneRef.current = true;
    firstRouteInput.focus();
  }, []);

  const selectSuggestionByIndex = (
    stopId: string,
    suggestions: GeocodeResult[],
    showPositionSuggestion: boolean,
    index: number,
  ) => {
    if (showPositionSuggestion && index === 0) {
      onUsePosition(stopId);
      return;
    }

    const resultIndex = showPositionSuggestion ? index - 1 : index;
    const result = suggestions[resultIndex];
    if (result) onSelectGeocode(stopId, result);
  };

  const handleSuggestionKeyDown = (
    e: ReactKeyboardEvent<HTMLInputElement>,
    stopId: string,
    suggestions: GeocodeResult[],
    showPositionSuggestion: boolean,
  ) => {
    const count = suggestions.length + (showPositionSuggestion ? 1 : 0);
    if (count === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex((current) => {
        if (current === null) return e.key === "ArrowDown" ? 0 : count - 1;
        return e.key === "ArrowDown"
          ? (current + 1) % count
          : (current - 1 + count) % count;
      });
      return;
    }

    if (e.key === "Enter" && activeSuggestionIndex !== null) {
      e.preventDefault();
      selectSuggestionByIndex(stopId, suggestions, showPositionSuggestion, activeSuggestionIndex);
    }
  };

  return (
    <div
      className={styles.routeBox}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        onDeactivate();
      }}
    >
      <div className={styles.routePanel}>
        <div className={styles.routeStops}>
          {visibleStops.map((stop, index) => {
            const isFirst = index === 0;
            const isLast = index === visibleStops.length - 1;
            const isCustomStop = isCustomRouteStop(stop);
            const loading = loadingStopId === stop.id || geocodingStopId === stop.id;
            const placeholder = isFirst ? "Välj startpunkt..." : isLast ? "Välj destination..." : "Via punkt";
            const suggestions = activeStopId === stop.id ? geocodeResultsByStop[stop.id] ?? [] : [];
            const showPositionSuggestion =
              isFirst && activeStop?.id === stop.id && !stop.label;
            const suggestionListId = `route-${stop.id}-suggestions`;
            return (
              <div
                key={stop.id}
                className={styles.routeStopGroup}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropStop(stop.id)}
              >
                <div
                  className={`${styles.routeInputRow} ${
                    isFirst ? styles.routeInputRowFirst : ""
                  } ${isLast ? styles.routeInputRowLast : ""}`}
                >
                  {loading ? (
                    <span className={styles.routeSpinner} aria-hidden="true" />
                  ) : (
                    <span
                      className={`${styles.routeIcon} ${
                        isFirst ? styles.routePositionInputIcon : styles.routeDestinationInputIcon
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <input
                    ref={isFirst ? firstRouteInputRef : undefined}
                    className={styles.routeInput}
                    value={stop.label}
                    onFocus={() => {
                      if (!isCustomStop) onFocusStop(stop.id);
                    }}
                    onChange={(e) => {
                      if (!isCustomStop) onChangeStop(stop.id, e.target.value);
                    }}
                    onKeyDown={(e) =>
                      !isCustomStop && handleSuggestionKeyDown(e, stop.id, suggestions, showPositionSuggestion)
                    }
                    placeholder={placeholder}
                    aria-label={isCustomStop ? "Via vald väg" : placeholder}
                    readOnly={isCustomStop}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={
                      suggestions.length > 0 || showPositionSuggestion ? suggestionListId : undefined
                    }
                    aria-expanded={suggestions.length > 0 || showPositionSuggestion}
                    aria-activedescendant={
                      activeStopId === stop.id && activeSuggestionIndex !== null
                        ? `route-${stop.id}-suggestion-${activeSuggestionIndex}`
                        : undefined
                    }
                  />
                  {stop.label && (
                    <button
                      type="button"
                      className={styles.routeClearBtn}
                      tabIndex={-1}
                      onClick={() => onClearStop(stop.id)}
                      aria-label={isCustomStop ? "Ta bort via-punkt" : `Rensa ${placeholder.toLowerCase()}`}
                    >
                      <span className={`${styles.routeIcon} ${styles.routeCloseIcon}`} aria-hidden="true" />
                    </button>
                  )}
                  {!isCustomStop && (
                    <button
                      type="button"
                      className={styles.routeDragBtn}
                      tabIndex={-1}
                      draggable
                      onDragStart={() => onDragStartStop(stop.id)}
                      onDragEnd={() => onDragStartStop("")}
                      aria-label={`Flytta ${placeholder.toLowerCase()}`}
                    >
                      <span className={`${styles.routeIcon} ${styles.routeDragIcon}`} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {showPositionSuggestion && (
                  <button
                    id={`route-${stop.id}-suggestion-0`}
                    type="button"
                    className={`${styles.routePositionSuggestion} ${
                      activeSuggestionIndex === 0 ? styles.routeSuggestionActive : ""
                    }`}
                    tabIndex={-1}
                    disabled={activeStopLoading}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveSuggestionIndex(0)}
                    onFocus={() => setActiveSuggestionIndex(0)}
                    onClick={() => onUsePosition(stop.id)}
                  >
                    <LocationIcon className={styles.routePositionIcon} />
                    <span>
                      {activeStopLoading ? "Hämtar plats..." : "Din plats"}
                    </span>
                  </button>
                )}
                {suggestions.length > 0 && (
                  <div id={suggestionListId} className={styles.routeSuggestions}>
                    {suggestions.map((result, suggestionIndex) => {
                      const optionIndex = showPositionSuggestion ? suggestionIndex + 1 : suggestionIndex;
                      return (
                      <button
                        key={result.id}
                        id={`route-${stop.id}-suggestion-${optionIndex}`}
                        type="button"
                        className={`${styles.routeSuggestion} ${
                          activeSuggestionIndex === optionIndex ? styles.routeSuggestionActive : ""
                        }`}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveSuggestionIndex(optionIndex)}
                        onFocus={() => setActiveSuggestionIndex(optionIndex)}
                        onClick={() => onSelectGeocode(stop.id, result)}
                      >
                        {result.shortLabel}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        <div className={styles.routeAvoidSection}>
          <div className={styles.routeAvoidHeading}>Undvik om möjligt</div>
          <div className={styles.routeAvoidList}>
            {(Object.keys(routeAvoidLabels) as RouteAvoidOption[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.routeAvoidPill} ${routeAvoids[option] ? styles.routeAvoidPillOn : ""}`}
                onClick={(event) => {
                  onToggleAvoid(option);
                  if (event.detail > 0) event.currentTarget.blur();
                }}
                aria-pressed={routeAvoids[option]}
                aria-describedby={`route-avoid-tooltip-${option}`}
              >
                <span className={styles.routeAvoidCheckbox} aria-hidden="true" />
                <span>{routeAvoidLabels[option]}</span>
                <span
                  id={`route-avoid-tooltip-${option}`}
                  className={styles.routeAvoidTooltip}
                  role="tooltip"
                >
                  {routeAvoidTooltips[option]}
                </span>
              </button>
            ))}
          </div>
        </div>
        {routeError && (
          <div className={styles.routeStatus} aria-live="polite" role="status">
            <WarningIcon className={styles.routeNoticeIcon} />
            <span>{routeError}</span>
          </div>
        )}
        {routeNoticeText && (
          <div className={styles.routeNotice} aria-live="polite">
            <WarningIcon className={styles.routeNoticeIcon} />
            <span>{routeNoticeText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
