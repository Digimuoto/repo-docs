import rawConfig from "../generated/site-config.json";

export interface NavigationSectionConfig {
  dir?: string;
  entries?: string[];
  label: string | null;
  links?: Array<{
    href: string;
    label: string;
  }>;
}

export type SiteTheme = "cortex-dark" | "cortex-light" | "cortex-slate";

export interface SiteThemeModes {
  dark: SiteTheme;
  light: SiteTheme;
}

export interface SiteLean4Config {
  theoryDir: string;
}

export interface SiteHaskellPackageConfig {
  description?: string | null;
  packageDir: string;
  packageName?: string | null;
  title?: string | null;
}

export interface SiteHaskellConfig {
  packages: Record<string, SiteHaskellPackageConfig>;
}

export interface SiteConfig {
  haskell: SiteHaskellConfig | null;
  lean4: SiteLean4Config | null;
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
  lean4: parseLean4((rawConfig as {lean4?: unknown}).lean4),
  haskell: parseHaskell((rawConfig as {haskell?: unknown}).haskell),
} as SiteConfig;

function parseLean4(raw: unknown): SiteLean4Config | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {theoryDir?: unknown};
  if (typeof candidate.theoryDir !== "string" || candidate.theoryDir.trim() === "") {
    return null;
  }
  return {theoryDir: candidate.theoryDir.trim()};
}

function parseHaskell(raw: unknown): SiteHaskellConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {packages?: unknown};
  if (!candidate.packages || typeof candidate.packages !== "object" || Array.isArray(candidate.packages)) {
    return null;
  }
  return {packages: candidate.packages as Record<string, SiteHaskellPackageConfig>};
}

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
  const isFilePath = /\.[^/]+$/.test(normalizedPath);

  if (base === "/") {
    if (normalizedPath === "") return "/";
    return isFilePath ? `/${normalizedPath}` : `/${normalizedPath}/`;
  }

  if (normalizedPath === "") return `${base}/`;
  return isFilePath ? `${base}/${normalizedPath}` : `${base}/${normalizedPath}/`;
}
