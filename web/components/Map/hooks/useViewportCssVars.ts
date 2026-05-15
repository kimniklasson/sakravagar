import { useEffect, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

export function useViewportCssVars(mapRef: RefObject<MapLibreMap | null>): void {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let stableViewportHeight = window.innerHeight;
    let stableViewportWidth = window.innerWidth;
    let appliedViewportHeight: number | null = null;
    let appliedViewportWidth: number | null = null;
    let touchActive = false;
    let pendingUpdateAfterTouch = false;

    const textInputFocused = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        Boolean(el instanceof HTMLElement && el.isContentEditable);
    };

    const updateViewportVars = (deferDuringTouch = true) => {
      if (touchActive && deferDuringTouch) {
        pendingUpdateAfterTouch = true;
        return;
      }

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const focused = textInputFocused();
        const widthChanged = Math.abs(window.innerWidth - stableViewportWidth) > 24;
        if (!focused || widthChanged) {
          stableViewportHeight = window.innerHeight;
          stableViewportWidth = window.innerWidth;
        }

        const viewportChanged =
          appliedViewportHeight !== stableViewportHeight ||
          appliedViewportWidth !== stableViewportWidth;
        if (viewportChanged) {
          root.style.setProperty("--app-visual-height", `${stableViewportHeight}px`);
        }
        if (root.style.getPropertyValue("--app-visual-top") !== "0px") {
          root.style.setProperty("--app-visual-top", "0px");
        }
        if (root.style.getPropertyValue("--app-visual-bottom") !== "0px") {
          root.style.setProperty("--app-visual-bottom", "0px");
        }
        appliedViewportHeight = stableViewportHeight;
        appliedViewportWidth = stableViewportWidth;
        if (viewportChanged) mapRef.current?.resize();
      });
    };

    const handleTouchStart = () => {
      touchActive = true;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      touchActive = false;
      if (!pendingUpdateAfterTouch) return;
      pendingUpdateAfterTouch = false;
      updateViewportVars(false);
    };
    const handleViewportChange = () => updateViewportVars();
    const handleFocusChange = () => updateViewportVars(false);

    updateViewportVars();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);
    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    window.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportChange);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
      window.removeEventListener("touchend", handleTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", handleTouchEnd, { capture: true });
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      root.style.removeProperty("--app-visual-height");
      root.style.removeProperty("--app-visual-top");
      root.style.removeProperty("--app-visual-bottom");
    };
  }, [mapRef]);
}
