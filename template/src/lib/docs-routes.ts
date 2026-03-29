import {getCollection} from "astro:content";
import {normalizeEntryId} from "./navigation";

export async function getDocStaticPaths() {
  const docs = await getCollection("docs", ({data}) => !data.draft);
  return docs.map((doc) => {
    const pageKey = normalizeEntryId(doc.id);
    return {
      params: {slug: pageKey === "index" ? undefined : pageKey},
      props: {doc},
    };
  });
}
