/*
 * Mode (light/dark) toggle wiring.
 *
 * The pre-paint inline script in DocsLayout's <head> has already
 * set `data-mode`, `data-theme`, and the `dark`/`light` class on
 * <html> by the time this runs. This module wires the click
 * handlers that *change* the mode, mirrors the change to
 * localStorage so it persists across reloads, and dispatches a
 * `repodocs:mode-change` custom event that consumers (Mermaid
 * enhancer, haddock iframe sync) re-render against.
 *
 * Mode toggle buttons are scattered across multiple components
 * (the sidebar footer toggle on desktop, the top-bar toggle on
 * mobile) — collect every `[data-mode-toggle]` element on the
 * page and bind the same shared handler so they stay in
 * lock-step.
 */

export function initModeToggle(): void {
  const modeToggles =
    document.querySelectorAll<HTMLButtonElement>("[data-mode-toggle]");
  if (modeToggles.length === 0) return;

  const first = modeToggles[0];
  const lightTheme = first.dataset.modeLight;
  const darkTheme = first.dataset.modeDark;
  const root = document.documentElement;

  function applyMode(mode: "light" | "dark") {
    if (!lightTheme || !darkTheme) return;
    const activeTheme = mode === "light" ? lightTheme : darkTheme;
    root.dataset.mode = mode;
    root.dataset.theme = activeTheme;
    root.classList.remove("dark", "light");
    root.classList.add(activeTheme === "cortex-light" ? "light" : "dark");
    try {
      localStorage.setItem("docs-mode", mode);
    } catch {
      /* localStorage may be unavailable */
    }
    document.dispatchEvent(
      new CustomEvent("repodocs:mode-change", {
        detail: { mode, theme: activeTheme },
      }),
    );
  }

  modeToggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = root.dataset.mode === "light" ? "dark" : "light";
      applyMode(next);
    });
  });
}
