export const mobileInfoBoxQuery = "(max-width: 767px)";

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(mobileInfoBoxQuery).matches;
}
