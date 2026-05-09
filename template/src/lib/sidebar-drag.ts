/*
 * Drag-to-resize handle on the sidebar's right edge.
 *
 * Long page titles in deep nav trees get truncated at the default
 * 280 px width. A pointer drag on the invisible 6 px handle grows
 * or shrinks the expanded width between MIN and MAX and persists
 * the chosen width to localStorage; the pre-paint inline script
 * in DocsLayout's <head> restores the saved width before first
 * paint to avoid layout flicker.
 *
 * Disabled on narrow viewports (<1024 px) where the sidebar
 * becomes a slide-in drawer with a fixed width, and while the
 * sidebar is collapsed (no rail to drag).
 */

const MIN = 200;
const MAX = 520;
const DEFAULT_WIDTH = 280;

export function initSidebarDrag(): void {
  const dragHandle = document.querySelector<HTMLElement>(
    "[data-docs-sidebar-drag]",
  );
  if (!dragHandle) return;

  const root = document.documentElement;
  let active = false;
  let startX = 0;
  let startWidth = 0;

  function syncWidth(px: number) {
    root.style.setProperty("--docs-sidebar-natural", px + "px");
    dragHandle!.setAttribute("aria-valuenow", String(Math.round(px)));
  }

  dragHandle.addEventListener("pointerdown", (event) => {
    if (window.innerWidth < 1024) return;
    if (root.dataset.sidebar === "collapsed") return;
    active = true;
    startX = event.clientX;
    const current = parseFloat(
      getComputedStyle(root).getPropertyValue("--docs-sidebar-natural"),
    );
    startWidth = isNaN(current) ? DEFAULT_WIDTH : current;
    dragHandle.setPointerCapture(event.pointerId);
    document.body.dataset.sidebarDragging = "true";
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (!active) return;
    const delta = event.clientX - startX;
    const next = Math.max(MIN, Math.min(MAX, startWidth + delta));
    syncWidth(next);
  });

  const finish = (event: PointerEvent) => {
    if (!active) return;
    active = false;
    dragHandle.releasePointerCapture(event.pointerId);
    delete document.body.dataset.sidebarDragging;
    const current = parseFloat(
      getComputedStyle(root).getPropertyValue("--docs-sidebar-natural"),
    );
    if (!isNaN(current)) {
      try {
        localStorage.setItem("docs-sidebar-width", String(Math.round(current)));
      } catch {
        /* ignore */
      }
    }
  };
  dragHandle.addEventListener("pointerup", finish);
  dragHandle.addEventListener("pointercancel", finish);

  // Double-click the handle to reset to default.
  dragHandle.addEventListener("dblclick", () => {
    if (window.innerWidth < 1024) return;
    root.style.removeProperty("--docs-sidebar-natural");
    try {
      localStorage.removeItem("docs-sidebar-width");
    } catch {
      /* ignore */
    }
    dragHandle.setAttribute("aria-valuenow", String(DEFAULT_WIDTH));
  });
}
