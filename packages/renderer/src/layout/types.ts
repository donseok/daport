import type { Style } from "@daport/core";

type PlacedBase = { elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string };

export type PlacedText = PlacedBase & { kind: "text"; lines: string[]; lineHeight: number; overflow: boolean };
export type PlacedImage = PlacedBase & { kind: "image"; src: string; fit: "contain" | "cover" | "stretch" };
export type PlacedLine = PlacedBase & { kind: "line"; x2: number; y2: number };
export type PlacedRect = PlacedBase & { kind: "rect" };
export type PlacedPlaceholder = PlacedBase & { kind: "placeholder"; label: string };

export type PlacedItem = PlacedText | PlacedImage | PlacedLine | PlacedRect | PlacedPlaceholder;

export type Page = { index: number; width: number; height: number; items: PlacedItem[] };
