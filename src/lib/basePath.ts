/**
 * Base path when the site is hosted under a sub-directory, e.g. GitHub Pages
 * (`https://user.github.io/Repo/` → NEXT_PUBLIC_BASE_PATH=/Repo). Next.js
 * prefixes its own routes and chunks; files in `public/` referenced by
 * absolute URL must go through `withBase`.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
