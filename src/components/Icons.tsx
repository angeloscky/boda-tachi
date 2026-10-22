import type { SVGProps } from 'react';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

export const GiftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3.5 8 4.2C6 4.8 7 8 12 8Zm0 0s1.5-4.5 4-3.8C18 4.8 17 8 12 8Z" />
  </svg>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </svg>
);

export const CheckCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M7.5 12.3 10.6 15.4 16.6 9" />
  </svg>
);

export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const ExternalIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const ChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const DressIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M9 3h6l-1 4 4 13H6l4-13-1-4Z" />
    <path d="M10 7h4" />
  </svg>
);

export const GlassesIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 3h5l-.4 5a2.1 2.1 0 0 1-4.2 0L6 3ZM13 3h5l-.4 5a2.1 2.1 0 0 1-4.2 0L13 3ZM8.5 10v8M15.5 10v8M6 21h5M13 21h5" />
  </svg>
);

/** Rama de olivo ligera para separar bloques. */
export const OliveBranch = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 160 40" fill="none" aria-hidden className="ornament" {...p}>
    <path d="M6 22c40-6 108-6 148 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    {[
      [30, 20, -28],
      [46, 25, 24],
      [60, 18, -26],
      [74, 24, 22],
      [88, 18, -24],
      [102, 24, 24],
      [116, 18, -26],
      [130, 24, 22],
    ].map(([x, y, r], i) => (
      <ellipse
        key={i}
        cx={x}
        cy={y}
        rx="7.5"
        ry="2.6"
        transform={`rotate(${r} ${x} ${y})`}
        fill="currentColor"
        opacity={i % 2 ? 0.75 : 0.95}
      />
    ))}
    <circle cx="80" cy="21" r="2.4" fill="currentColor" />
  </svg>
);
