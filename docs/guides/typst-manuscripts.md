---
title: Typst Manuscripts
description: Compile configured Typst manuscript folders into PDF reader pages.
---

# Typst Manuscripts

repo-docs can compile explicit Typst manuscript folders into PDFs and publish
them as full-viewport reader pages. The integration is intentionally explicit:
repo-docs does not autodetect `.typ` files because real manuscript folders often
contain layouts, bibliographies, figures, scratch files, and alternate drafts.

## Configure a Manuscript

```nix
docsSite.sites.docs = {
  contentDir = ./docs;

  typst.manuscripts.paper1.dir = "Publications/Paper-1/typst";
};
```

The `dir` value is relative to `contentDir`.

## Folder Layout

```text
docs/Publications/Paper-1/
  index.md
  typst/
    repo-docs-typst.json
    manuscript.typ
    layout.typ
    references.bib
    figures/
```

`repo-docs-typst.json` defines the Typst entry point, generated reader route,
and sidebar metadata:

```json
{
  "entry": "manuscript.typ",
  "output": "manuscript.pdf",
  "route": "Publications/Paper-1/manuscript",
  "title": "Paper 1",
  "description": "Rendered PDF manuscript.",
  "sidebar": {
    "label": "Manuscript",
    "order": 2
  }
}
```

## Generated Output

The example above publishes:

- `/Publications/Paper-1/manuscript/` — a chrome-free PDF reader route.
- `/Publications/Paper-1/manuscript.pdf` — the compiled PDF asset.

If the generated route would overwrite an authored Markdown page, the build
fails. This keeps Markdown web drafts and Typst PDF manuscripts explicit rather
than silently replacing one with the other.
