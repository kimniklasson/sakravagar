import { useLayoutEffect, type RefObject } from "react";

export function useRouteControlsBottom(routeControlsRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const element = routeControlsRef.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      document.documentElement.style.setProperty("--route-controls-bottom", `${Math.ceil(rect.bottom)}px`);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--route-controls-bottom");
    };
  }, [routeControlsRef]);
}
