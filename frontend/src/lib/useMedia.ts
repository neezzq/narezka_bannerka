import { useEffect, useState } from "react";

/** Live result of a CSS media query. */
export function useMedia(query: string) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/** The desktop layout: side panels instead of bottom sheets. */
export const DESKTOP = "(min-width: 1024px)";
