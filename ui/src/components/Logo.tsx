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
        <linearGradient id="cbs-shield-gradient" x1="8" y1="4" x2="56" y2="60">
          <stop offset="0%" stopColor="#4cf0c4" />
          <stop offset="52%" stopColor="#3ec6ff" />
          <stop offset="100%" stopColor="#6a7dff" />
        </linearGradient>
        <linearGradient id="cbs-shield-inner" x1="20" y1="16" x2="44" y2="50">
          <stop offset="0%" stopColor="#0b1220" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0b1220" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="#0b1220" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="16.25"
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="1.5"
      />
      <path
        d="M32 7.5 53 15v15.2c0 12.1-8.3 21.9-21 26.3-12.7-4.4-21-14.2-21-26.3V15L32 7.5Z"
        fill="url(#cbs-shield-gradient)"
      />
      <path
        d="M32 12.6 48.2 18.5v11.7c0 9.5-6.3 17.4-16.2 21.3-9.9-3.9-16.2-11.8-16.2-21.3V18.5L32 12.6Z"
        fill="url(#cbs-shield-inner)"
      />
      <path
        d="m23.5 31.5 6.2 6.3 11-12.4"
        stroke="#eafffb"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
