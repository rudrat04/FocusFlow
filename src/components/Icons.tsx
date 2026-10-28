import type { ReactElement } from "react";

const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const paths: Record<string, ReactElement> = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  next: <><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none" /><path d="M18 5.5v13" {...p} strokeWidth={2} /></>,
  prev: <><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none" /><path d="M6 5.5v13" {...p} strokeWidth={2} /></>,
  shuffle: <><path {...p} d="M3 7h3.5c2 0 3.3 1 4.5 3l2 4c1.2 2 2.5 3 4.5 3H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.5M13.2 8.5C14.2 7.5 15.3 7 16.5 7H21" /><path {...p} d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5" /></>,
  repeat: <><path {...p} d="M4 11V9.5A2.5 2.5 0 016.5 7H20M17 4l3 3-3 3M20 13v1.5a2.5 2.5 0 01-2.5 2.5H4M7 20l-3-3 3-3" /></>,
  heart: <path {...p} d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.6 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" />,
  heartFill: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.6 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" stroke="none" />,
  now: <><circle {...p} cx="12" cy="12" r="8.5" /><path d="M10.2 8.8v6.4l5-3.2z" fill="currentColor" stroke="none" /></>,
  library: <><path {...p} d="M9 18V6l10-2v12" /><circle {...p} cx="6.5" cy="18" r="2.5" /><circle {...p} cx="16.5" cy="16" r="2.5" /></>,
  playlists: <path {...p} d="M4 7h12M4 12h12M4 17h7M18 14v6M15 17h6" />,
  clock: <><circle {...p} cx="12" cy="12" r="8.5" /><path {...p} d="M12 7.5V12l3 2" /></>,
  gear: <><circle {...p} cx="12" cy="12" r="3" /><path {...p} d="M19.4 14a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
  search: <><circle {...p} cx="11" cy="11" r="6.5" /><path {...p} d="M16 16l4 4" /></>,
  plus: <path {...p} d="M12 5v14M5 12h14" />,
  folder: <path {...p} d="M3.5 7.5A2 2 0 015.5 5.5h4l2 2.5h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />,
  link: <path {...p} d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  trash: <path {...p} d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7" />,
  x: <path {...p} d="M6 6l12 12M18 6L6 18" />,
  volume: <><path {...p} d="M4 10v4h3.5l4.5 3.5v-11L7.5 10z" /><path {...p} d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /></>,
  mute: <><path {...p} d="M4 10v4h3.5l4.5 3.5v-11L7.5 10z" /><path {...p} d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  moon: <path {...p} d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  headphones: <path {...p} d="M4 15v-3a8 8 0 0116 0v3M4 15v3a1.5 1.5 0 001.5 1.5H7v-6H5.5A1.5 1.5 0 004 15zM20 15v3a1.5 1.5 0 01-1.5 1.5H17v-6h1.5A1.5 1.5 0 0120 15z" />,
  more: <><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /></>,
  heartNav: <path {...p} d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.6 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" />,
  refresh: <path {...p} d="M20 11a8 8 0 00-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0014 4.5L20 15M20 20v-5h-5" />,
  up: <path {...p} strokeWidth={2} d="M6.500 14.500l5.500-5.500 5.500 5.500" />,
  down: <path {...p} strokeWidth={2} d="M6.500 9.500l5.500 5.500 5.500-5.500" />,
  image: <><rect {...p} x="4" y="5" width="16" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><path {...p} d="M5 17l5-5 4 4 2-2 3 3" /></>,
  album: <><rect {...p} x="4" y="4" width="16" height="16" rx="3" /><circle {...p} cx="12" cy="12" r="3.2" /></>,
  check: <path {...p} strokeWidth={2.2} d="M5 12.5l4.5 4.5L19 7.5" />,
  edit: <path {...p} d="M4 20h4L19 9a2.100 2.100 0 00-3-3L5 17zM14 7l3 3" />,
  shuffleSolid: <><path {...p} d="M3 7h3.500c2 0 3.300 1 4.500 3l2 4c1.200 2 2.500 3 4.500 3H21M3 17h3.500c1.400 0 2.400-.5 3.300-1.500M13.200 8.500C14.200 7.500 15.300 7 16.500 7H21" /><path {...p} d="M18.500 4.500L21 7l-2.500 2.500M18.500 14.500L21 17l-2.500 2.500" /></>,
  minus: <><circle {...p} cx="12" cy="12" r="8.500" /><path {...p} d="M8.500 12h7" /></>,
  grip: <><circle cx="9" cy="7" r="1.400" fill="currentColor" /><circle cx="15" cy="7" r="1.400" fill="currentColor" /><circle cx="9" cy="12" r="1.400" fill="currentColor" /><circle cx="15" cy="12" r="1.400" fill="currentColor" /><circle cx="9" cy="17" r="1.400" fill="currentColor" /><circle cx="15" cy="17" r="1.400" fill="currentColor" /></>,
  pin: <path {...p} d="M9 4h6l-1 5 3 3v1.500H7V12l3-3zM12 13.500V20" />,
  expand: <path {...p} d="M14 5h5v5M19 5l-6 6M10 19H5v-5M5 19l6-6" />,
  mini: <><rect {...p} x="3.500" y="5" width="17" height="13" rx="2.500" /><rect x="11" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" /></>,
  wave: <path {...p} d="M4 12h1M8 8v8M12 5v14M16 8v8M20 12h-1" />,
};

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {paths[name] ?? null}
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 48 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M24 14c-3.5-5.5-6.5-8-10-8a8 8 0 000 16c3.5 0 6.5-2.500 10-8zm0 0c3.5 5.500 6.500 8 10 8a8 8 0 000-16c-3.500 0-6.500 2.500-10 8z" />
    </svg>
  );
}
