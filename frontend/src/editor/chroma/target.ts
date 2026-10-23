import { useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { bannerSources } from "../banners/BannerLayer";
import { playback } from "../playback";

/** The preview element of a chroma target and a still image to fall back to. */
export function chromaSource(target: string) {
  const st = useEditor.getState();
  if (target === "video") return { src: playback.video, fallback: st.meta?.media?.posterUrl ?? null };
  const banner = st.doc?.banners.find((b) => b.id === target);
  const asset = banner ? useAssets.getState().assets.find((a) => a.id === banner.assetId) : undefined;
  return { src: bannerSources.get(target)?.() ?? null, fallback: asset?.thumbUrl ?? null };
}
