import { cx } from "@/lib/utils/cx";

/**
 * Small inline Instagram and YouTube marks for the paste-a-link card, so a visitor
 * recognises the two sites at a glance. Drawn here because lucide no longer ships
 * brand icons. Each sits on the text baseline next to the site's name.
 */
type Props = { size?: number; className?: string };

export function InstagramLogo({ size = 18, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cx("inline-block shrink-0 align-[-0.2em] text-sys-pink", className)} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function YouTubeLogo({ size = 18, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cx("inline-block shrink-0 align-[-0.2em] text-sys-red", className)} aria-hidden>
      <path fill="currentColor" d="M23.5 6.6a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.5A3 3 0 0 0 .5 6.6 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.4 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.4Z" />
      <path fill="#fff" d="M9.6 15.4V8.6l6.2 3.4-6.2 3.4Z" />
    </svg>
  );
}
