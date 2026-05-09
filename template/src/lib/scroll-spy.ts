/*
 * TOC scroll-spy primitive.
 *
 * "Active" = the last heading whose top has scrolled past a trigger
 * line near the top of the visible viewport (default 120 px — just
 * below the comfortable reading zone). This matches reader
 * expectations: clicking a TOC link highlights that heading, not the
 * next one. The 2rem scroll-margin-top on each heading puts an
 * anchored heading at ~32 px, comfortably above the trigger so it
 * wins the "last past the line" check.
 *
 * Both the desktop TOC (DocsLayout.astro) and the Haddock-iframe TOC
 * (HaddockEmbed.astro) use this — the only difference is whether the
 * scroll source is `window` or `iframe.contentWindow`. Hence the
 * `scrollTarget` parameter.
 */

export interface ScrollSpyEntry {
  /** Anchor id this heading corresponds to. */
  id: string;
  /** Heading element to measure. */
  heading: HTMLElement;
  /** Sidebar item that should toggle `is-active`. */
  item: HTMLElement;
}

export interface ScrollSpyOptions {
  /** Pixel offset from the top of the scroll target. Default 120 px. */
  trigger?: number;
  /**
   * Scroll source. Defaults to `window`. Pass an iframe's
   * `contentWindow` to spy on its embedded document instead.
   */
  scrollTarget?: Window | null;
  /**
   * Bail-out scroll position below which the first entry stays
   * highlighted (so the reader always has a reference point before
   * any heading has crossed the trigger). Default 40 px.
   */
  topGuard?: number;
}

/**
 * Wire scroll + resize listeners that toggle `is-active` on each
 * `entry.item` based on which `entry.heading` last crossed the
 * trigger line. Returns a teardown function that removes the
 * listeners — call it on cross-document navigation (e.g. when the
 * Haddock iframe loads a different module).
 */
export function attachScrollSpy(
  entries: ScrollSpyEntry[],
  {
    trigger = 120,
    scrollTarget = typeof window === "undefined" ? null : window,
    topGuard = 40,
  }: ScrollSpyOptions = {},
): () => void {
  if (entries.length === 0 || !scrollTarget) {
    return () => {};
  }

  const setActive = (id: string | null) => {
    for (const entry of entries) {
      entry.item.classList.toggle("is-active", entry.id === id);
    }
  };

  const computeActive = () => {
    let active: string | null = null;
    for (const entry of entries) {
      const top = entry.heading.getBoundingClientRect().top;
      if (top <= trigger) {
        active = entry.id;
      } else {
        break;
      }
    }
    if (active === null && (scrollTarget.scrollY ?? 0) < topGuard) {
      active = entries[0].id;
    }
    setActive(active);
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const raf = scrollTarget.requestAnimationFrame ?? requestAnimationFrame;
    raf(() => {
      scheduled = false;
      computeActive();
    });
  };

  scrollTarget.addEventListener("scroll", schedule, { passive: true });
  scrollTarget.addEventListener("resize", schedule);
  computeActive();

  return () => {
    scrollTarget.removeEventListener("scroll", schedule);
    scrollTarget.removeEventListener("resize", schedule);
  };
}
