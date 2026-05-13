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

    const textInputFocused = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        Boolean(el instanceof HTMLElement && el.isContentEditable);
    };

    const updateViewportVars = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const focused = textInputFocused();
        const widthChanged = Math.abs(window.innerWidth - stableViewportWidth) > 24;
        if (!focused || widthChanged) {
          stableViewportHeight = window.innerHeight;
          stableViewportWidth = window.innerWidth;
        }

        root.style.setProperty("--app-visual-height", `${stableViewportHeight}px`);
        root.style.setProperty("--app-visual-top", "0px");
        root.style.setProperty("--app-visual-bottom", "0px");
        const viewportChanged =
          appliedViewportHeight !== stableViewportHeight ||
          appliedViewportWidth !== stableViewportWidth;
        appliedViewportHeight = stableViewportHeight;
        appliedViewportWidth = stableViewportWidth;
        if (viewportChanged) mapRef.current?.resize();
      });
    };

    updateViewportVars();
    window.addEventListener("resize", updateViewportVars);
    window.addEventListener("focusin", updateViewportVars);
    window.addEventListener("focusout", updateViewportVars);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("focusin", updateViewportVars);
      window.removeEventListener("focusout", updateViewportVars);
      window.visualViewport?.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportVars);
      root.style.removeProperty("--app-visual-height");
      root.style.removeProperty("--app-visual-top");
      root.style.removeProperty("--app-visual-bottom");
    };
  }, [mapRef]);
}
