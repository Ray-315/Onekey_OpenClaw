import { describe, expect, it, vi } from "vitest";

import { lockDesktopShell } from "@/lib/context-menu";
import * as tauri from "@/lib/tauri";

describe("lockDesktopShell", () => {
  it("does not block the context menu outside Tauri", () => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(false);
    const target = document.createElement("div");
    const cleanup = lockDesktopShell(target);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });

  it("blocks the context menu inside Tauri", () => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(true);
    const target = document.createElement("div");
    const cleanup = lockDesktopShell(target);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it("blocks text selection outside interactive fields inside Tauri", () => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(true);
    const container = document.createElement("div");
    const text = document.createElement("span");
    const input = document.createElement("input");
    container.append(text, input);
    const cleanup = lockDesktopShell(container);
    const textEvent = new Event("selectstart", { bubbles: true, cancelable: true });
    const inputEvent = new Event("selectstart", { bubbles: true, cancelable: true });

    text.dispatchEvent(textEvent);
    input.dispatchEvent(inputEvent);

    expect(textEvent.defaultPrevented).toBe(true);
    expect(inputEvent.defaultPrevented).toBe(false);
    cleanup();
  });

  it("blocks drag interactions outside interactive fields inside Tauri", () => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(true);
    const container = document.createElement("div");
    const card = document.createElement("div");
    const textarea = document.createElement("textarea");
    container.append(card, textarea);
    const cleanup = lockDesktopShell(container);
    const cardEvent = new Event("dragstart", { bubbles: true, cancelable: true });
    const textareaEvent = new Event("dragstart", { bubbles: true, cancelable: true });

    card.dispatchEvent(cardEvent);
    textarea.dispatchEvent(textareaEvent);

    expect(cardEvent.defaultPrevented).toBe(true);
    expect(textareaEvent.defaultPrevented).toBe(false);
    cleanup();
  });
});
