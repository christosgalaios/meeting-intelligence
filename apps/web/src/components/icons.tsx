import type { ReactNode } from 'react';

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconLibrary = () => (
  <Icon>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Icon>
);

export const IconSearch = ({ size }: { size?: number }) => (
  <Icon {...(size ? { size } : {})}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Icon>
);

export const IconLock = ({ size }: { size?: number }) => (
  <Icon {...(size ? { size } : {})}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);

export const IconInfo = ({ size }: { size?: number }) => (
  <Icon {...(size ? { size } : {})}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v4" />
    <circle cx="8" cy="4.9" r=".4" />
  </Icon>
);

export const IconChevron = ({ size }: { size?: number }) => (
  <Icon {...(size ? { size } : {})}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const IconTheme = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11" />
  </Icon>
);
