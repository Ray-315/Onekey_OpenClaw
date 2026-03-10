import { isTauriRuntime } from "@/lib/tauri";

function isAllowedInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true'], [data-allow-shell-menu='true']"));
}

export function lockDesktopShell(target: Document | HTMLElement = document) {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const root = target instanceof Document ? target.documentElement : target;
  root.classList.add("tauri-shell-locked");

  const handleContextMenu = (event: Event) => {
    event.preventDefault();
  };

  const handleSelectStart = (event: Event) => {
    if (!isAllowedInteractiveTarget(event.target)) {
      event.preventDefault();
    }
  };

  const handleDragStart = (event: Event) => {
    if (!isAllowedInteractiveTarget(event.target)) {
      event.preventDefault();
    }
  };

  target.addEventListener("contextmenu", handleContextMenu);
  target.addEventListener("selectstart", handleSelectStart);
  target.addEventListener("dragstart", handleDragStart);

  return () => {
    target.removeEventListener("contextmenu", handleContextMenu);
    target.removeEventListener("selectstart", handleSelectStart);
    target.removeEventListener("dragstart", handleDragStart);
    root.classList.remove("tauri-shell-locked");
  };
}

export function disableContextMenu(target: Document | HTMLElement = document) {
  return lockDesktopShell(target);
}
