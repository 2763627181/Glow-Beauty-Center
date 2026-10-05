import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { CATALOG_TAG } from "@/lib/data/cache-tags";

/** Invalida el contenido público cacheado para que un cambio del admin se vea de inmediato. Solo desde Server Actions. */
export function refreshPublicSite() {
  updateTag(CATALOG_TAG);
  revalidatePath("/", "layout");
}
