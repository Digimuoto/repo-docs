import type {CollectionEntry} from "astro:content";
import {kebabToTitle, siteConfig, withBasePath} from "./site-config";

type DocsEntry = CollectionEntry<"docs">;

export interface SidebarNode {
  children: SidebarNode[];
  href?: string;
  isGroup: boolean;
  key: string;
  label: string;
}

export interface SidebarSection {
  items: SidebarNode[];
  key: string;
  label: string | null;
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
  const normalized = pathValue.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  return normalized === "" ? "index" : normalized;
}

function slugKey(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
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
        current = current.dirs.get(segment)!;
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
      current = current.dirs.get(segment)!;
    }
    current.pages.push(page);
  }

  return root;
}

function materializeDirectoryNode(
  node: DirectoryNode,
  parentKey: string,
): SidebarNode[] {
  const nodes: SidebarNode[] = [];

  // Leaf pages first, then subdirectories — matches the flat-renderer ordering
  // so existing docs keep their structural layout.
  for (const page of [...node.pages].sort(comparePages)) {
    if (page.hidden) {
      continue;
    }
    nodes.push({
      children: [],
      href: page.href,
      isGroup: false,
      key: `page:${page.key}`,
      label: page.label,
    });
  }

  for (const [segment, child] of [...node.dirs.entries()].sort(
    compareDirectoryEntries,
  )) {
    const childPath = parentKey === "" ? segment : `${parentKey}/${segment}`;
    const label = child.page?.label ?? kebabToTitle(segment);
    const hiddenLanding = child.page?.hidden ?? false;
    const href = child.page && !hiddenLanding ? child.page.href : undefined;
    const children = materializeDirectoryNode(child, childPath);

    nodes.push({
      children,
      href,
      isGroup: !href,
      key: href ? `page:${child.page!.key}` : `group:${childPath}`,
      label,
    });
  }

  return nodes;
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

  return siteConfig.navigation.map((section, index) => {
    const rawLabel = section.label;
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== "" ? rawLabel : null;
    const sectionKey = label ? `section:${slugKey(label)}` : `section:root-${index}`;

    if (section.entries) {
      return {
        items: section.entries
          .map((slug) => requirePage(pagesByKey, slug, label ?? "(root)"))
          .filter((page) => !page.hidden)
          .map(
            (page): SidebarNode => ({
              children: [],
              href: page.href,
              isGroup: false,
              key: `page:${page.key}`,
              label: page.label,
            }),
          ),
        key: sectionKey,
        label,
      };
    }

    const rootKey = normalizeConfigPath(section.dir!);
    const dirPages = pages.filter(
      (page) => page.key === rootKey || page.key.startsWith(`${rootKey}/`),
    );

    const tree = buildDirectoryNode(rootKey, dirPages);
    return {
      items: materializeDirectoryNode(tree, rootKey === "index" ? "" : rootKey),
      key: sectionKey,
      label,
    };
  });
}
