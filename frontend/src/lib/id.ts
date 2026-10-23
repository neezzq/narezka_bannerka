import { t } from "@/i18n";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function uid(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return t("units.bytes", { n });
  if (n < 1024 * 1024) return t("units.kb", { n: Math.round(n / 1024) });
  return t("units.mb", { n: (n / 1024 / 1024).toFixed(1).replace(".", ",") });
}
