import ru from "./ru.json";

type Dict = { [key: string]: string | Dict };

const dictionaries: Record<string, Dict> = { ru };
let current: Dict = ru;

export function setLocale(locale: string): void {
  current = dictionaries[locale] ?? ru;
}

/** Translate a dotted key: t("home.uploading", { percent: 40 }). Missing keys return the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  let node: string | Dict | undefined = current;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") break;
    node = node[part];
  }
  if (typeof node !== "string") return key;
  if (!params) return node;
  return node.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Russian plural: plural(5, ["слово", "слова", "слов"]) → "слов". */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
