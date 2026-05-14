import type { RouteLine } from "@/lib/routeTypes";

export type LayerController = { setVisible: (v: boolean) => void };
export type LayerLoadingCallback = (loading: boolean) => void;
export type RouteClickHandler = (routeId: string) => void;
export type RouteAnnotationVisibility = Partial<Record<keyof RouteLine["annotations"], boolean>>;
