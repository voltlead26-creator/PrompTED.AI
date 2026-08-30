import type { CSSProperties } from "react";

export interface IconProps {
  name: string;
  label?: string;
  size?: number;
  color?: string;
  className?: string;
}

const VISIBLE_SYMBOLS: Record<string, string> = { x: "×", plus: "+", minus: "−" };
const P: Record<string, string[]> = {
  home: ["M3 11.5 12 4l9 7.5", "M5.5 10v10h13V10", "M9 20v-6h6v6"],
  "file-pencil": ["M6 3h8l4 4v6", "M14 3v5h5", "M5 21l1-4 10-10 3 3-10 10-4 1Z"],
  folders: ["M3 7h7l2 2h9v11H3Z", "M3 7V5h7l2 2"],
  "list-check": ["m4 7 2 2 3-4", "M11 7h9", "m4 15 2 2 3-4", "M11 15h9"],
  briefcase: ["M4 7h16v12H4Z", "M9 7V4h6v3", "M4 12h16", "M10 12v2h4v-2"],
  "user-circle": [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    "M8 19c1-4 7-4 8 0",
    "M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4 21c1-6 15-6 16 0"],
  settings: [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
    "M19 13.5l2 1-2 3-2-.5-1.5 1.5.5 2-3 1-1-2h-2l-1 2-3-1 .5-2L5 17l-2 .5-1-3 2-1v-3l-2-1 1-3 2 .5L6.5 5 6 3l3-1 1 2h3l1-2 3 1-.5 2L18 6.5l2-.5 1 3-2 1Z",
  ],
  "menu-2": ["M4 7h16", "M4 12h16", "M4 17h16"],
  "chevron-right": ["m9 5 7 7-7 7"],
  "chevron-left": ["m15 5-7 7 7 7"],
  "chevron-down": ["m5 9 7 7 7-7"],
  "chevron-up": ["m5 15 7-7 7 7"],
  "arrow-right": ["M4 12h16", "m14 6 6 6-6 6"],
  "arrow-left": ["M20 12H4", "m10 6-6 6 6 6"],
  "arrow-up": ["M12 20V4", "m6 10 6-6 6 6"],
  "arrow-down": ["M12 4v16", "m6-6 6 6 6-6"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M4 16v4h16v-4"],
  download: ["M12 4v12", "m7-5 5 5 5-5", "M4 20h16"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14", "m16 16 5 5"],
  check: ["m4 12 5 5L20 6"],
  "circle-check": ["M22 11a10 10 0 1 1-5-8", "m8 11 3 3 8-8"],
  circle: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20"],
  edit: ["M4 20h4L20 8l-4-4L4 16v4Z", "m14-14 4 4"],
  pencil: ["M4 20h4L20 8l-4-4L4 16v4Z"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M7 7l1 14h8l1-14", "M10 11v6", "M14 11v6"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"],
  file: ["M6 3h8l4 4v14H6Z", "M14 3v5h5"],
  "file-text": ["M6 3h8l4 4v14H6Z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  sparkles: [
    "m12 2 1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2Z",
    "m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  ],
  star: ["m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L7.2 20l1-6.1-4.4-4.3 6.1-.9L12 3Z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 6v6l4 2"],
  history: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5", "M12 7v5l3 2"],
  rotate: ["M20 7V3l-3 3a8 8 0 1 0 2 9"],
  dots: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  "dots-vertical": ["M12 5h.01", "M12 12h.01", "M12 19h.01"],
  "alert-circle": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 7v6", "M12 17h.01"],
  "help-circle": [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.2-1 2.2",
    "M12 17h.01",
  ],
  building: ["M5 21V4h10v17", "M15 9h4v12", "M8 8h1", "M12 8h1", "M8 12h1", "M12 12h1"],
  book: ["M4 5c3-1 5 0 8 2v14c-3-2-5-3-8-2Z", "M20 5c-3-1-5 0-8 2v14c3-2 5-3 8-2Z"],
  bulb: ["M9 18h6", "M10 22h4", "M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"],
  photo: ["M4 5h16v14H4Z", "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4", "m4 17 4-4 3 3 3-3 6 6"],
  microphone: ["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z", "M5 11a7 7 0 0 0 14 0", "M12 18v4"],
  "message-chatbot": ["M4 5h16v12H9l-5 4Z", "M8 10h.01", "M12 10h.01", "M16 10h.01"],
  "layout-grid": ["M4 4h6v6H4Z", "M14 4h6v6h-6Z", "M4 14h6v6H4Z", "M14 14h6v6h-6Z"],
  template: ["M4 4h16v16H4Z", "M4 9h16", "M10 9v11"],
  "arrows-maximize": [
    "M8 4H4v4",
    "m4 4-5-5",
    "M16 4h4v4",
    "m-4-4 5-5",
    "M8 20H4v-4",
    "M16 20h4v-4",
  ],
  "arrows-minimize": ["M4 8h4V4", "M20 8h-4V4", "M4 16h4v4", "M20 16h-4v4"],
  "loader-2": ["M21 12a9 9 0 1 1-3-6.7"],
  lock: ["M6 10h12v11H6Z", "M8 10V7a4 4 0 0 1 8 0v3"],
  "lock-open": ["M6 10h12v11H6Z", "M9 10V7a4 4 0 0 1 7-2"],
  save: ["M5 3h12l2 2v16H5Z", "M8 3v6h8V3", "M8 14h8v7H8Z"],
  sun: [
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
    "M12 2v2",
    "M12 20v2",
    "M4.9 4.9l1.4 1.4",
    "M17.7 17.7l1.4 1.4",
    "M2 12h2",
    "M20 12h2",
    "M4.9 19.1l1.4-1.4",
    "M17.7 6.3l1.4-1.4",
  ],
  moon: ["M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"],
  monitor: ["M3 4h18v12H3Z", "M8 20h8", "M12 16v4"],
  "text-size": ["M4 20 9 4h2l5 16", "M6.5 14h7"],
  "credit-card": ["M3 6h18v12H3Z", "M3 10h18"],
};

export function Icon({ name, label, size = 20, color, className }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    color: color ?? "inherit",
    flexShrink: 0,
  };
  const decorative = !label;
  const symbol = VISIBLE_SYMBOLS[name];
  if (symbol)
    return (
      <span
        className={className}
        style={{ ...style, display: "inline-grid", placeItems: "center", fontWeight: 700 }}
        aria-hidden={decorative || undefined}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
      >
        {symbol}
      </span>
    );
  const paths = P[name] ?? ["M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.2-1 2.2", "M12 18h.01"];
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={`${name}-${i}`} d={d} />
      ))}
    </svg>
  );
}
