/** Shifa Portal brand mark: a shield (protection) holding a pulse line (continuous care). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="shifa-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14a193" />
          <stop offset="1" stopColor="#0a5c6b" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#shifa-g)" />
      <path d="M16 5.5l8.2 3v7.2c0 5.1-3.5 8.6-8.2 10.8-4.7-2.2-8.2-5.7-8.2-10.8V8.5z" fill="#fff" fillOpacity=".96" />
      <path d="M10.8 16.2h3.2l1.6-3.6 2.4 7 1.7-3.4h1.7" fill="none" stroke="#0b6b63" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ ar, en }: { ar: string; en: string }) {
  return (
    <span className="wordmark">
      <strong>{ar}</strong>
      <small>{en}</small>
    </span>
  );
}
