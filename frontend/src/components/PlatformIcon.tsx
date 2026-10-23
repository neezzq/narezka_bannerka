import { FileVideo } from "lucide-react";
import type { Platform } from "@/lib/types";

/** Simple brand-coloured glyphs drawn from basic shapes (no third-party logos copied). */
export function PlatformIcon({ platform, size = 22 }: { platform: Platform | null; size?: number }) {
  if (platform === "youtube")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="YouTube" role="img">
        <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0033" />
        <path d="M10 8.8v6.4l5.4-3.2z" fill="#fff" />
      </svg>
    );
  if (platform === "twitch")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Twitch" role="img">
        <path d="M4.5 2.5h16v11l-4.5 4.5h-3.5l-3 3v-3H5.5l-1-1z" fill="#9146FF" />
        <path d="M10.5 7v5M15.5 7v5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (platform === "tiktok")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="TikTok" role="img">
        <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#111" />
        <path d="M13.2 5.5v9.2a2.6 2.6 0 1 1-2.6-2.6" fill="none" stroke="#25F4EE" strokeWidth="2" strokeLinecap="round" transform="translate(-0.7 0.6)" />
        <path d="M13.2 5.5v9.2a2.6 2.6 0 1 1-2.6-2.6" fill="none" stroke="#FE2C55" strokeWidth="2" strokeLinecap="round" transform="translate(0.7 -0.4)" />
        <path d="M13.2 5.5v9.2a2.6 2.6 0 1 1-2.6-2.6M13.2 5.5c.4 1.8 1.7 3 3.6 3.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  return <FileVideo size={size} className="text-label-2" aria-label="Файл" />;
}
