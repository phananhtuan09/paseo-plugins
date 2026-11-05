import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readStored(key: string): string | null {
  if (Platform.OS !== "web") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  if (Platform.OS !== "web") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable or full; the level then resets on the next load.
  }
}
