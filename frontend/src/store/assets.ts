import { create } from "zustand";
import { api, uploadAsset } from "@/lib/api";
import { waitJob } from "@/lib/jobs";
import type { Asset } from "@/lib/types";

interface Upload {
  id: string;
  name: string;
  progress: number;
  stage: "upload" | "processing";
}

interface AssetsState {
  assets: Asset[];
  loaded: boolean;
  uploads: Upload[];
  load: () => Promise<void>;
  upload: (file: File) => Promise<Asset>;
  remove: (id: string) => Promise<void>;
  byId: (id: string) => Asset | undefined;
  /** show an asset that only exists in this browser yet (blob URL) */
  addLocal: (asset: Asset) => void;
  /** upload without a progress tile in the library (text images) */
  uploadQuiet: (file: File) => Promise<Asset>;
}

export const useAssets = create<AssetsState>((set, get) => ({
  assets: [],
  loaded: false,
  uploads: [],
  load: async () => {
    try {
      const { assets } = await api.listAssets();
      set({ assets, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  upload: async (file) => {
    const id = `${Date.now()}-${file.name}`;
    const patch = (p: Partial<Upload>) => set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...p } : u)) }));
    set((s) => ({ uploads: [...s.uploads, { id, name: file.name, progress: 0, stage: "upload" }] }));
    try {
      const { promise } = uploadAsset(file, (progress) => patch({ progress }));
      const res = await promise;
      let asset = res.asset;
      if (res.jobId) {
        patch({ stage: "processing", progress: 0 });
        const job = await waitJob<{ asset: Asset }>(res.jobId, (j) => patch({ progress: j.progress }));
        asset = job.result!.asset;
      }
      set((s) => ({ assets: [asset, ...s.assets.filter((a) => a.id !== asset.id)] }));
      return asset;
    } finally {
      set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
    }
  },
  remove: async (id) => {
    await api.deleteAsset(id);
    set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));
  },
  byId: (id) => get().assets.find((a) => a.id === id),
  addLocal: (asset) => set((s) => ({ assets: [asset, ...s.assets] })),
  uploadQuiet: async (file) => {
    const { asset } = await uploadAsset(file).promise;
    set((s) => ({ assets: [asset, ...s.assets.filter((a) => a.id !== asset.id)] }));
    return asset;
  },
}));

/** Text banner images live in the asset store but not in the banner library. */
export const TEXT_ASSET_NAME = "bannerka-text.png";
export const isTextAsset = (a: Pick<Asset, "name">) => a.name === TEXT_ASSET_NAME;
