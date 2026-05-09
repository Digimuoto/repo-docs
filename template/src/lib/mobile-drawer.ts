/*
 * Mobile sidebar drawer + on-page TOC disclosure.
 *
 * Two pieces of mobile chrome wired here:
 *   1. The site-nav drawer, opened from the top-bar hamburger
 *      (`[data-mobile-menu-toggle]`) and closed by the overlay
 *      backdrop, by an in-drawer link tap, or by Escape.
 *   2. The on-page TOC disclosure (`<details>` with id
 *      `docs-mobile-toc`). The top bar carries a TOC button
 *      that opens / closes the disclosure remotely, and the
 *      button's `aria-expanded` mirrors the disclosure state.
 */

const MOBILE_BREAKPOINT_DRAWER = 1024;
const MOBILE_BREAKPOINT_TOC = 1280;

export function initMobileDrawer(): void {
  const sidebarEl = document.getElementById("docs-sidebar");
  const mobileOverlay = document.getElementById("mobile-overlay");
  const mobileToggles = document.querySelectorAll<HTMLElement>(
    "[data-mobile-menu-toggle]",
  );
  const mobileTocToggles = document.querySelectorAll<HTMLElement>(
    "[data-mobile-toc-toggle]",
  );
  const mobileTocEl = document.getElementById(
    "docs-mobile-toc",
  ) as HTMLDetailsElement | null;

  function setMobileOpen(open: boolean) {
    if (open) {
      sidebarEl?.setAttribute("data-mobile-open", "true");
      mobileOverlay?.setAttribute("data-mobile-open", "true");
      // Lock body scroll while the drawer is open so phones don't
      // rubber-band the page behind it.
      document.body.classList.add("docs-scroll-locked");
    } else {
      sidebarEl?.removeAttribute("data-mobile-open");
      mobileOverlay?.removeAttribute("data-mobile-open");
      document.body.classList.remove("docs-scroll-locked");
    }
    mobileToggles.forEach((btn) =>
      btn.setAttribute("aria-expanded", open ? "true" : "false"),
    );
  }

  mobileToggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isOpen = sidebarEl?.getAttribute("data-mobile-open") === "true";
      setMobileOpen(!isOpen);
    });
  });
  mobileOverlay?.addEventListener("click", () => setMobileOpen(false));
  document.querySelectorAll("#docs-sidebar a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth < MOBILE_BREAKPOINT_DRAWER) setMobileOpen(false);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (sidebarEl?.getAttribute("data-mobile-open") === "true") {
      setMobileOpen(false);
    }
  });

  function syncTocToggle(open: boolean) {
    mobileTocToggles.forEach((btn) =>
      btn.setAttribute("aria-expanded", open ? "true" : "false"),
    );
  }
  if (mobileTocEl) {
    syncTocToggle(mobileTocEl.open);
    mobileTocEl.addEventListener("toggle", () =>
      syncTocToggle(mobileTocEl.open),
    );
    mobileTocToggles.forEach((btn) => {
      btn.addEventListener("click", () => {
        mobileTocEl.open = !mobileTocEl.open;
        // Keep the disclosure visible: scroll it into view when
        // opened from the top bar so the reader's eye lands on
        // the anchors instead of mid-article.
        if (mobileTocEl.open) {
          mobileTocEl.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      });
    });
    // Tapping any anchor inside the disclosure closes it so the
    // panel doesn't keep covering the heading the reader just
    // scrolled to.
    mobileTocEl.querySelectorAll("a").forEach((anchor) => {
      anchor.addEventListener("click", () => {
        if (window.innerWidth < MOBILE_BREAKPOINT_TOC) mobileTocEl.open = false;
      });
    });
  }
}
