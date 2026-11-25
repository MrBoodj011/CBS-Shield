export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Logo CBS Shield"
    >
      <defs>
        <linearGradient id="cbs-logo-bg" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="#4f86f0" />
          <stop offset="100%" stopColor="#2a5fd0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#cbs-logo-bg)" />
      <path
        d="M32 12 48 17.6v11.6c0 10.4-6.6 18.4-16 22-9.4-3.6-16-11.6-16-22V17.6L32 12Z"
        fill="#ffffff"
        fillOpacity="0.16"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="m25 31.6 5.2 5.2 9.6-10.4"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
