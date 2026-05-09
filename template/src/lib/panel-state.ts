/*
 * Sidebar / TOC panel state + nav-tree collapse persistence.
 *
 * Two related concerns share this module because they both
 * persist to localStorage and run on the same elements:
 *
 *   - Panel collapse: each rail-style chevron carries
 *     `data-collapse="sidebar|toc"` (collapse) or
 *     `data-expand="sidebar|toc"` (expand). Clicks flip
 *     `data-sidebar` / `data-toc` on <html> and persist the
 *     choice. The pre-paint inline script in DocsLayout's <head>
 *     restores the saved state before first paint to avoid
 *     layout flicker.
 *   - Nav-tree collapse: each branch's <ul> carries
 *     `data-nav-children-of="<key>"` and a sibling toggle
 *     button carries `data-nav-toggle="<key>"`. Clicks flip
 *     `data-nav-open`. Active-path branches are forced open at
 *     load regardless of stored state so the current page
 *     always stays in view.
 */

export function initPanelState(): void {
  const root = document.documentElement;
  const STORAGE = {
    sidebar: "docs-sidebar-state",
    toc: "docs-toc-state",
  } as const;

  function setPanel(panel: "sidebar" | "toc", collapsed: boolean) {
    root.dataset[panel] = collapsed ? "collapsed" : "expanded";
    try {
      localStorage.setItem(
        STORAGE[panel],
        collapsed ? "collapsed" : "expanded",
      );
    } catch {
      /* ignore */
    }
  }

  document
    .querySelectorAll<HTMLButtonElement>("[data-collapse]")
    .forEach((button) => {
      const target = button.dataset.collapse as "sidebar" | "toc";
      button.addEventListener("click", () => setPanel(target, true));
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-expand]")
    .forEach((button) => {
      const target = button.dataset.expand as "sidebar" | "toc";
      button.addEventListener("click", () => setPanel(target, false));
    });

  // Nav-tree collapse: read stored state, close matching lists
  // unless their descendants include the active page.
  const NAV_STORAGE = "docs-nav-collapsed";
  const collapsed = new Set<string>();
  try {
    const raw = localStorage.getItem(NAV_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const key of parsed) {
          if (typeof key === "string") collapsed.add(key);
        }
      }
    }
  } catch {
    /* ignore */
  }

  function writeNavState() {
    try {
      localStorage.setItem(NAV_STORAGE, JSON.stringify([...collapsed]));
    } catch {
      /* ignore */
    }
  }

  function setNavOpen(key: string, open: boolean) {
    document
      .querySelectorAll<HTMLElement>(
        `[data-nav-children-of="${CSS.escape(key)}"]`,
      )
      .forEach((list) => {
        list.dataset.navOpen = open ? "true" : "false";
      });
    document
      .querySelectorAll<HTMLElement>(`[data-nav-toggle="${CSS.escape(key)}"]`)
      .forEach((toggle) => {
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
  }

  // Apply stored collapsed state at load — but skip any list whose
  // active-path flag is true so the current page stays visible.
  document
    .querySelectorAll<HTMLElement>("[data-nav-children-of]")
    .forEach((list) => {
      const key = list.dataset.navChildrenOf;
      if (!key) return;
      if (!collapsed.has(key)) return;
      if (list.dataset.navActivePath === "true") return;
      setNavOpen(key, false);
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-nav-toggle]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        const key = button.dataset.navToggle;
        if (!key) return;
        event.preventDefault();
        const list = document.querySelector<HTMLElement>(
          `[data-nav-children-of="${CSS.escape(key)}"]`,
        );
        if (!list) return;
        const nextOpen = list.dataset.navOpen !== "true";
        setNavOpen(key, nextOpen);
        if (nextOpen) collapsed.delete(key);
        else collapsed.add(key);
        writeNavState();
      });
    });
}
