import type { MaterialKind } from "@sniptoss/core";

// 16px line icons, the stroke follows the text color
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function KindIcon({ kind }: { kind: MaterialKind }) {
  switch (kind) {
    case "image":
      return (
        <svg {...base}>
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <circle cx="6" cy="6.5" r="1.2" />
          <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
        </svg>
      );
    case "video":
      return (
        <svg {...base}>
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M6.8 6v4l3.4-2z" />
        </svg>
      );
    case "pdf":
      return (
        <svg {...base}>
          <path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 01-1 1h-7.5a1 1 0 01-1-1V2.8a1 1 0 011-1z" />
          <path d="M9 1.8V5h3.5M5.5 8.5h5M5.5 11h3.5" />
        </svg>
      );
    case "slides":
      return (
        <svg {...base}>
          <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.5" />
          <path d="M8 11v2.5M5.5 13.5h5" />
        </svg>
      );
  }
}

/** App icon (matches the master design/icon/sniptoss.svg) */
export function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="none" stroke="#5b8cff" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <path d="M36 92V60a24 24 0 0 1 24-24h32" />
        <path d="M164 36h32a24 24 0 0 1 24 24v32" />
        <path d="M220 164v32a24 24 0 0 1-24 24h-32" />
        <path d="M92 220H60a24 24 0 0 1-24-24v-32" />
      </g>
      <path
        d="M104 80h48a24 24 0 0 1 24 24v82l-20-10h-52a24 24 0 0 1-24-24v-48a24 24 0 0 1 24-24z"
        fill="none"
        stroke="#ff6a3d"
        strokeWidth="18"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg {...base}>
      <path d="M2 4.5a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
    </svg>
  );
}

/** Filter (funnel): the library's "show only items with open notes" */
export function FilterIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 3.5h11l-4.3 5.1v3.9l-2.4 1.1V8.6z" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...base}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </svg>
  );
}

// ---------- Icons for the toolbar and buttons (16px line) ----------

const I = (props: { children: React.ReactNode }) => <svg {...base}>{props.children}</svg>;

export const SelectIcon = () => (
  <I>
    <path d="M3.5 2.5l9 4.6-3.9 1.2-1.6 3.9z" />
  </I>
);
export const HandIcon = () => (
  <I>
    <path d="M5.5 8.5V3.8a1 1 0 012 0V7.5M7.5 7V2.8a1 1 0 012 0V7.5M9.5 7.2V3.8a1 1 0 012 0V9c0 2.8-1.9 5-4.6 5-1.7 0-2.7-.7-3.6-2L2.4 9.7a1 1 0 011.6-1.2l1.5 1.6" />
  </I>
);
export const PointIcon = () => (
  <I>
    <path d="M8 14s4.5-4.1 4.5-7.4A4.5 4.5 0 003.5 6.6C3.5 9.9 8 14 8 14z" />
    <circle cx="8" cy="6.6" r="1.6" />
  </I>
);
export const RectIcon = () => (
  <I>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
  </I>
);
export const PenIcon = () => (
  <I>
    <path d="M2.5 12.5c2.5-1 3-6 5.5-6s1.5 4 3.5 4 2-3 2-3" />
  </I>
);
export const ArrowIcon = () => (
  <I>
    <path d="M3 13L13 3M7 3h6v6" />
  </I>
);
export const NoteIcon = () => (
  <I>
    <path d="M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5V11.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z" />
    <path d="M5 6.5h6M5 8.5h4" />
  </I>
);
/** Timestamped comment: a clock face */
export const ClockIcon = () => (
  <I>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.25l2.25 1.5" />
  </I>
);
export const SparkIcon = () => (
  <I>
    <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
  </I>
);
/** Six-tooth gear. The earlier "circle + eight short lines" read as a sun at 16px (retired in docs/design-rules.md) */
export const GearIcon = () => (
  <I>
    <path d="M6.32 3.4L6.63 1.54A6.6 6.6 0 0 1 9.37 1.54L9.68 3.4A4.9 4.9 0 0 1 11.15 4.25L12.9 3.58A6.6 6.6 0 0 1 14.28 5.96L12.83 7.15A4.9 4.9 0 0 1 12.83 8.85L14.28 10.04A6.6 6.6 0 0 1 12.9 12.42L11.15 11.75A4.9 4.9 0 0 1 9.68 12.6L9.37 14.46A6.6 6.6 0 0 1 6.63 14.46L6.32 12.6A4.9 4.9 0 0 1 4.85 11.75L3.1 12.42A6.6 6.6 0 0 1 1.72 10.04L3.17 8.85A4.9 4.9 0 0 1 3.17 7.15L1.72 5.96A6.6 6.6 0 0 1 3.1 3.58L4.85 4.25A4.9 4.9 0 0 1 6.32 3.4Z" />
    <circle cx="8" cy="8" r="2" />
  </I>
);
export const HelpIcon = () => (
  <I>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.8.5-1.3.9-1.3 1.8M8 11.3v.1" />
  </I>
);
export const EditIcon = () => (
  <I>
    <path d="M10.5 2.8l2.7 2.7L6 12.7l-3.4.7.7-3.4z" />
  </I>
);
export const CopyIcon = () => (
  <I>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" />
  </I>
);
export const CheckIcon = () => (
  <I>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </I>
);
/** Resolved (done / won't fix): a check mark in a circle */
export const DoneIcon = () => (
  <I>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
  </I>
);
/** Marks are shown on the canvas (the switch on the zoom bar, "Hide mark" on a note card) */
export const EyeIcon = () => (
  <I>
    <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </I>
);
/** Marks are hidden on the canvas: an eye with a diagonal slash */
export const EyeOffIcon = () => (
  <I>
    <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
    <path d="M2.5 2.5l11 11" />
  </I>
);
export const ReopenIcon = () => (
  <I>
    <path d="M3 8a5 5 0 109-3M12 2v3H9" />
  </I>
);
export const BanIcon = () => (
  <I>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M4.2 11.8l7.6-7.6" />
  </I>
);
export const TrashIcon = () => (
  <I>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 001 .8h3.8a1 1 0 001-.8l.6-8.2" />
  </I>
);
export const FileIcon = () => (
  <I>
    <path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 01-1 1h-7.5a1 1 0 01-1-1V2.8a1 1 0 011-1z" />
    <path d="M9 1.8V5h3.5" />
  </I>
);
export const ChevronIcon = () => (
  <I>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </I>
);
export const PlusIcon = () => (
  <I>
    <path d="M8 3v10M3 8h10" />
  </I>
);
export const MinusIcon = () => (
  <I>
    <path d="M3 8h10" />
  </I>
);
export const UndoIcon = () => (
  <I>
    <path d="M5 4L2.5 6.5 5 9" />
    <path d="M2.5 6.5H10a3.5 3.5 0 010 7H7" />
  </I>
);
export const RedoIcon = () => (
  <I>
    <path d="M11 4l2.5 2.5L11 9" />
    <path d="M13.5 6.5H6a3.5 3.5 0 000 7h3" />
  </I>
);
// ---------- Library ----------

/** Pin to top: a pushpin. filled = pinned */
export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <I>
    <path d="M6 2.5h4l-.6 3.8 2.4 2.2H4.2l2.4-2.2zM8 8.5v5" fill={filled ? "currentColor" : "none"} />
  </I>
);
export const MoreIcon = () => (
  <I>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.2} />
  </I>
);
/** Screen Capture: a viewfinder frame (same idea as the app icon) with a note inside */
export const CaptureIcon = () => (
  <I>
    <path d="M2.5 5.5v-2a1 1 0 011-1h2M10.5 2.5h2a1 1 0 011 1v2M13.5 10.5v2a1 1 0 01-1 1h-2M5.5 13.5h-2a1 1 0 01-1-1v-2" />
    <path d="M5.5 6.5h5M5.5 9.5h3" />
  </I>
);
/** New version available: a downward arrow in a circle (the "new version" indicator in the title bar) */
export const UpdateIcon = () => (
  <I>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v5.5M5.8 8.3 8 10.5l2.2-2.2" />
  </I>
); /** Error: an exclamation mark in a circle (the error toast) */
export const AlertIcon = () => (
  <I>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5.3v3.4M8 10.7v.1" />
  </I>
);
export const CloseIcon = () => (
  <I>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </I>
);
export const RefreshIcon = () => (
  <I>
    <path d="M13 3.5v3h-3" />
    <path d="M12.6 6.5A5 5 0 103 8" />
  </I>
);
/** Clear the library: a stack of lines + a cross (not a trash can: entries are only removed from the library, files are not deleted) */
export const ClearListIcon = () => (
  <I>
    <path d="M2.5 4h8M2.5 7.5h8M2.5 11h5M10 10l3.5 3.5M13.5 10L10 13.5" />
  </I>
);
export const FolderPlusIcon = () => (
  <I>
    <path d="M2 4.5a1 1 0 011-1h3.2l1.3 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
    <path d="M8 7v4M6 9h4" />
  </I>
);
export const FilePlusIcon = () => (
  <I>
    <path d="M9.2 1.8H4a1 1 0 00-1 1v10.4a1 1 0 001 1h7.5a1 1 0 001-1V5z" />
    <path d="M9 1.8V5h3.5M7.75 7.5v4.5M5.5 9.75h4.5" />
  </I>
);
