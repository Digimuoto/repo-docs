import type {CollectionEntry} from "astro:content";
import {kebabToTitle, siteConfig, withBasePath} from "./site-config";

type DocsEntry = CollectionEntry<"docs">;

export interface SidebarItem {
  depth: number;
  href?: string;
  kind: "group" | "page";
  label: string;
}

export interface SidebarSection {
  items: SidebarItem[];
  label: string;
}

interface PageMeta {
  hidden: boolean;
  href: string;
  isIndexPage: boolean;
  key: string;
  label: string;
  order: number | null;
  relativeSegments: string[];
}

interface DirectoryNode {
  dirs: Map<string, DirectoryNode>;
  page?: PageMeta;
  pages: PageMeta[];
}

function normalizeEntryId(entryId: string) {
  const withoutExtension = entryId.replace(/\.(md|mdx)$/i, "");
  if (withoutExtension === "index") {
    return "index";
  }
  return withoutExtension.replace(/\/index$/i, "");
}

export {normalizeEntryId};

function normalizeConfigPath(pathValue: string) {
  return pathValue.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
}

function getPageMeta(entry: DocsEntry): PageMeta {
  const rawId = entry.id.replace(/\\/g, "/");
  const isIndexPage = rawId === "index" || rawId.endsWith("/index");
  const key = normalizeEntryId(rawId);
  const relativeSegments = key === "index" ? [] : key.split("/");

  return {
    hidden: entry.data.sidebar?.hidden ?? false,
    href: withBasePath(key === "index" ? "" : key),
    isIndexPage,
    key,
    label: entry.data.sidebar?.label ?? entry.data.title,
    order: entry.data.sidebar?.order ?? null,
    relativeSegments,
  };
}

function comparePages(left: PageMeta, right: PageMeta) {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.label.localeCompare(right.label);
}

function compareDirectoryEntries(
  left: [string, DirectoryNode],
  right: [string, DirectoryNode],
) {
  const leftSort = left[1].page?.order ?? Number.MAX_SAFE_INTEGER;
  const rightSort = right[1].page?.order ?? Number.MAX_SAFE_INTEGER;

  if (leftSort !== rightSort) {
    return leftSort - rightSort;
  }

  const leftLabel = left[1].page?.label ?? kebabToTitle(left[0]);
  const rightLabel = right[1].page?.label ?? kebabToTitle(right[0]);
  return leftLabel.localeCompare(rightLabel);
}

function createDirectoryNode(): DirectoryNode {
  return {
    dirs: new Map(),
    pages: [],
  };
}

function buildDirectoryNode(rootKey: string, pages: PageMeta[]) {
  const root = createDirectoryNode();

  for (const page of pages) {
    if (page.key === rootKey) {
      root.page = page;
      continue;
    }

    const relative = page.key.slice(rootKey.length + 1).split("/");
    if (page.isIndexPage) {
      let current = root;
      for (const segment of relative) {
        if (!current.dirs.has(segment)) {
          current.dirs.set(segment, createDirectoryNode());
        }
        current = current.dirs.get(segment);
      }
      current.page = page;
      continue;
    }

    const directorySegments = relative.slice(0, -1);
    let current = root;
    for (const segment of directorySegments) {
      if (!current.dirs.has(segment)) {
        current.dirs.set(segment, createDirectoryNode());
      }
      current = current.dirs.get(segment);
    }
    current.pages.push(page);
  }

  return root;
}

function flattenDirectoryNode(node: DirectoryNode, depth: number): SidebarItem[] {
  const items: SidebarItem[] = [];

  for (const page of [...node.pages].sort(comparePages)) {
    if (page.hidden) {
      continue;
    }
    items.push({
      depth,
      href: page.href,
      kind: "page",
      label: page.label,
    });
  }

  for (const [segment, child] of [...node.dirs.entries()].sort(compareDirectoryEntries)) {
    const label = child.page?.label ?? kebabToTitle(segment);
    const hiddenLandingPage = child.page?.hidden ?? false;

    if (child.page && !hiddenLandingPage) {
      items.push({
        depth,
        href: child.page.href,
        kind: "page",
        label,
      });
    } else {
      items.push({
        depth,
        kind: "group",
        label,
      });
    }

    items.push(...flattenDirectoryNode(child, depth + 1));
  }

  return items;
}

function requirePage(
  pagesByKey: Map<string, PageMeta>,
  slug: string,
  sectionLabel: string,
) {
  const page = pagesByKey.get(normalizeConfigPath(slug));
  if (!page) {
    throw new Error(`Missing navigation entry "${slug}" in section "${sectionLabel}".`);
  }
  return page;
}

export function buildSidebar(entries: DocsEntry[]): SidebarSection[] {
  const pages = entries
    .filter((entry) => !entry.data.draft)
    .map(getPageMeta);
  const pagesByKey = new Map(pages.map((page) => [page.key, page]));

  return siteConfig.navigation.map((section) => {
    if (section.entries) {
      return {
        items: section.entries
          .map((slug) => requirePage(pagesByKey, slug, section.label))
          .filter((page) => !page.hidden)
          .sort(comparePages)
          .map((page) => ({
            depth: 0,
            href: page.href,
            kind: "page" as const,
            label: page.label,
          })),
        label: section.label,
      };
    }

    const rootKey = normalizeConfigPath(section.dir);
    const dirPages = pages.filter(
      (page) => page.key === rootKey || page.key.startsWith(`${rootKey}/`),
    );

    const tree = buildDirectoryNode(rootKey, dirPages);
    return {
      items: flattenDirectoryNode(tree, 0),
      label: section.label,
    };
  });
}
