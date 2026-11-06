import type { PluginTheme } from "@getpaseo/plugin";

type Colors = PluginTheme["colors"];

export interface Palette {
  blue: string;
  amber: string;
  violet: string;
}

// The host theme has one accent and green/amber/red statuses, and the accent is green in some themes,
// so it cannot tell phases or code tokens apart. These hues are fixed, with a variant for each brightness.
const DARK: Palette = { blue: "#8fb8ff", amber: "#ffc66d", violet: "#cfa9ff" };
const LIGHT: Palette = { blue: "#2f5fc4", amber: "#9a6700", violet: "#6f42c1" };

export function paletteFor(colors: Colors): Palette {
  return isLight(colors.surface0) ? LIGHT : DARK;
}

/** Brightness of a `#rgb`, `#rrggbb` or `rgb()` color; anything unreadable counts as dark. */
export function isLight(color: string): boolean {
  const hex = /^#([\da-f]{3}|[\da-f]{6})/i.exec(color.trim());
  let rgb: number[] | undefined;
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  } else {
    const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color.trim());
    if (match) rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (!rgb) return false;
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 140;
}
