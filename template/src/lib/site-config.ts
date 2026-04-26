import rawConfig from "../generated/site-config.json";

export interface NavigationSectionConfig {
  dir?: string;
  entries?: string[];
  label: string | null;
}

export type SiteTheme = "cortex-dark" | "cortex-light" | "cortex-slate";

export interface SiteThemeModes {
  dark: SiteTheme;
  light: SiteTheme;
}

export interface SiteConfig {
  navigation: NavigationSectionConfig[];
  repo?: {
    editBaseUrl?: string;
    repoUrl?: string;
  };
  site: {
    description?: string;
    footerText?: string;
    publicBaseUrl: string;
    routeBase: string;
    tagline: string;
    title: string;
  };
  theme: SiteTheme;
  themeModes: SiteThemeModes | null;
}

const THEMES: ReadonlyArray<SiteTheme> = ["cortex-dark", "cortex-light", "cortex-slate"];
function isTheme(value: unknown): value is SiteTheme {
  return typeof value === "string" && (THEMES as ReadonlyArray<string>).includes(value);
}

function parseThemeModes(raw: unknown): SiteThemeModes | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {light?: unknown; dark?: unknown};
  if (!isTheme(candidate.light) || !isTheme(candidate.dark)) return null;
  return {light: candidate.light, dark: candidate.dark};
}

function stripTrailingSlash(value: string) {
  if (value === "/") {
    return "/";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeRouteBase(routeBase: string) {
  if (!routeBase || routeBase === "/") {
    return "/";
  }

  const normalized = routeBase.startsWith("/") ? routeBase : `/${routeBase}`;
  return stripTrailingSlash(normalized);
}

export const siteConfig = {
  ...rawConfig,
  site: {
    ...rawConfig.site,
    routeBase: normalizeRouteBase(rawConfig.site.routeBase),
  },
  theme: ((): SiteTheme => {
    const raw = (rawConfig as {theme?: string}).theme;
    if (raw === "cortex-light") return "cortex-light";
    if (raw === "cortex-slate") return "cortex-slate";
    return "cortex-dark";
  })(),
  themeModes: parseThemeModes((rawConfig as {themeModes?: unknown}).themeModes),
} as SiteConfig;

export function kebabToTitle(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function withBasePath(pathname = "") {
  const base = stripTrailingSlash(siteConfig.site.routeBase || "/");
  const normalizedPath = pathname.replace(/^\/+|\/+$/g, "");

  if (base === "/") {
    return normalizedPath === "" ? "/" : `/${normalizedPath}/`;
  }

  return normalizedPath === "" ? `${base}/` : `${base}/${normalizedPath}/`;
}
