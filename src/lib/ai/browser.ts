import { useEffect, useState } from "react";

/**
 * Whether this is desktop Google Chrome, the only browser with the built-in AI the Post tool uses.
 * Edge, Opera and other Chrome look-alikes carry their own name in the user agent; phones are left out.
 */
export function isDesktopChrome(ua: string, brands?: { brand: string }[]): boolean {
  if (/Mobi|Android|CriOS|FxiOS/i.test(ua)) return false;
  if (brands?.length) return brands.some((b) => b.brand === "Google Chrome") && !brands.some((b) => /Edge|Opera|Brave|Vivaldi/i.test(b.brand));
  return /Chrome\//.test(ua) && !/Edg\/|OPR\/|Vivaldi\/|SamsungBrowser\//.test(ua);
}

/** True in desktop Chrome. False on the server and on first paint, so the page renders the same everywhere before it knows. */
export function useIsDesktopChrome(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
    setYes(isDesktopChrome(nav.userAgent, nav.userAgentData?.brands));
  }, []);
  return yes;
}
