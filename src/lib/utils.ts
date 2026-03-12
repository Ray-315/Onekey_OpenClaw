import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Platform } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatScanTime(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return "刚刚";
  }

  return new Date(parsed).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function labelPlatform(platform: "macos" | "windows") {
  return platform === "macos" ? "macOS" : "Windows";
}

export function detectClientPlatform(): Platform {
  if (typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("mac")) {
    return "macos";
  }

  return "windows";
}
