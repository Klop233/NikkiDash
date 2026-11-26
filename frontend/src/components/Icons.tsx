import type { JSX } from 'preact';

type Props = { className?: string };

const svg = (paths: JSX.Element, cls?: string, size = 20) => (
  <svg
    class={cls}
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {paths}
  </svg>
);

export const IconOverview = ({ className }: Props) =>
  svg(
    <>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1" />
    </>,
    className
  );

export const IconProxies = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M3 8h14M3 12h14M10 2.75a10.5 10.5 0 0 1 0 14.5M10 2.75a10.5 10.5 0 0 0 0 14.5" />
    </>,
    className
  );

export const IconConnections = ({ className }: Props) =>
  svg(
    <>
      <path d="M3.5 10h13M13 6.5L16.5 10 13 13.5M7 13.5L3.5 10 7 6.5" />
    </>,
    className
  );

export const IconRules = ({ className }: Props) =>
  svg(
    <>
      <path d="M7 5.5h9.5M7 10h9.5M7 14.5h9.5M3.5 5.5h.5M3.5 10h.5M3.5 14.5h.5" />
    </>,
    className
  );

export const IconProfiles = ({ className }: Props) =>
  svg(
    <>
      <path d="M11.5 2.75H5.5a1.5 1.5 0 0 0-1.5 1.5v11.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7.25z" />
      <path d="M11.5 2.75v4.5H16M7 11h6M7 14h4" />
    </>,
    className
  );

export const IconSettings = ({ className }: Props) =>
  svg(
    <>
      <path d="M3.5 6h13M3.5 14h13" />
      <circle cx="7.5" cy="6" r="1.75" fill="var(--bg-surface)" />
      <circle cx="12.5" cy="14" r="1.75" fill="var(--bg-surface)" />
    </>,
    className
  );

export const IconCode = ({ className }: Props) =>
  svg(
    <>
      <path d="M13 6.5L16.5 10 13 13.5M7 6.5L3.5 10 7 13.5" />
    </>,
    className
  );

export const IconLogs = ({ className }: Props) =>
  svg(
    <>
      <path d="M4 6.5L7.5 10 4 13.5M10 14.5h6" />
    </>,
    className
  );

export const IconShield = ({ className }: Props) =>
  svg(
    <>
      <path d="M10 2.75l6.25 2.5v4.5c0 4-2.7 6.75-6.25 7.75-3.55-1-6.25-3.75-6.25-7.75v-4.5z" />
    </>,
    className
  );

export const IconMenu = ({ className }: Props) =>
  svg(
    <>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
    </>,
    className
  );

export const IconSpark = ({ className }: Props) =>
  svg(
    <>
      <path d="M10.75 2.75L4.5 11h5.25l-.75 6.25 6.5-8.25h-5.25z" />
    </>,
    className
  );

export const IconSun = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M15.1 4.9l-1.05 1.05M5.95 14.05L4.9 15.1" />
    </>,
    className
  );

export const IconMoon = ({ className }: Props) =>
  svg(
    <>
      <path d="M15.5 11.75A6 6 0 0 1 8.25 4.5a6.25 6.25 0 1 0 7.25 7.25z" />
    </>,
    className
  );

export const IconSearch = ({ className }: Props) =>
  svg(
    <>
      <circle cx="9" cy="9" r="5.25" />
      <path d="M13 13l3.5 3.5" />
    </>,
    className,
    16
  );

export const IconPlus = ({ className }: Props) =>
  svg(
    <>
      <path d="M10 4.5v11M4.5 10h11" />
    </>,
    className,
    16
  );

export const IconClose = ({ className }: Props) =>
  svg(
    <>
      <path d="M5 5l10 10M15 5L5 15" />
    </>,
    className,
    16
  );

export const IconInfo = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9v4.5M10 6.5v.25" />
    </>,
    className
  );

export const IconWarning = ({ className }: Props) =>
  svg(
    <>
      <path d="M10 3.25l7.25 13H2.75z" />
      <path d="M10 8.25v3.5M10 14v.25" />
    </>,
    className
  );

export const IconError = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.5V11M10 13.5v.25" />
    </>,
    className
  );

export const IconSuccess = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M6.75 10.25l2.25 2.25 4.25-4.5" />
    </>,
    className
  );

export const IconCheck = ({ className }: Props) =>
  svg(
    <>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </>,
    className,
    16
  );

export const IconBolt = ({ className }: Props) =>
  svg(
    <>
      <path d="M10.75 2.75L4.5 11h5.25l-.75 6.25 6.5-8.25h-5.25z" />
    </>,
    className,
    16
  );

export const IconChevronLeft = ({ className }: Props) =>
  svg(
    <>
      <path d="M12 4.5L6.5 10 12 15.5" />
    </>,
    className,
    16
  );

export const IconChevronRight = ({ className }: Props) =>
  svg(
    <>
      <path d="M8 4.5L13.5 10 8 15.5" />
    </>,
    className,
    16
  );

export const IconCrosshair = ({ className }: Props) =>
  svg(
    <>
      <circle cx="10" cy="10" r="5" />
      <path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5" />
    </>,
    className,
    16
  );

export const IconTabs = ({ className }: Props) =>
  svg(
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M8.5 4v4" />
    </>,
    className,
    16
  );

export const IconList = ({ className }: Props) =>
  svg(
    <>
      <path d="M4 5.5h12M4 10h12M4 14.5h12" />
    </>,
    className,
    16
  );

export const IconSliders = ({ className }: Props) =>
  svg(
    <>
      <path d="M3.5 6h13M3.5 14h13" />
      <circle cx="7.5" cy="6" r="1.75" fill="var(--bg-surface)" />
      <circle cx="12.5" cy="14" r="1.75" fill="var(--bg-surface)" />
    </>,
    className,
    16
  );

export const IconCopy = ({ className }: Props) =>
  svg(
    <>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </>,
    className,
    16
  );

export const IconChevronDown = ({ className }: Props) =>
  svg(
    <>
      <path d="M5 7.5L10 12.5 15 7.5" />
    </>,
    className,
    16
  );
