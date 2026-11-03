/** Decorative illustration: a health file card with a vitals trend and a protected-share badge. */
export function HeroArt() {
  return (
    <svg viewBox="0 0 360 300" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="ha-card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#e8f4f2" /></linearGradient>
        <linearGradient id="ha-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#3ecf8e" /><stop offset="1" stopColor="#0a5c6b" /></linearGradient>
      </defs>
      <rect x="40" y="30" width="280" height="220" rx="22" fill="url(#ha-card)" />
      <circle cx="82" cy="72" r="20" fill="#24b47e" />
      <path d="M72 72h6l3-7 4 14 3-7h4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="112" y="60" width="96" height="10" rx="5" fill="#0f2229" fillOpacity=".78" />
      <rect x="112" y="78" width="64" height="8" rx="4" fill="#0f2229" fillOpacity=".25" />
      <rect x="252" y="60" width="50" height="22" rx="11" fill="#dcf4e3" />
      <circle cx="266" cy="71" r="4" fill="#17612f" />
      <rect x="274" y="68" width="20" height="6" rx="3" fill="#17612f" fillOpacity=".7" />
      <g stroke="#0f2229" strokeOpacity=".08">
        <path d="M64 130h232M64 160h232M64 190h232M64 220h232" />
      </g>
      <path d="M64 200 L104 176 L144 188 L184 148 L224 160 L264 126 L296 138" fill="none" stroke="url(#ha-line)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M64 200 L104 176 L144 188 L184 148 L224 160 L264 126 L296 138 V232 H64Z" fill="#3ecf8e" fillOpacity=".12" />
      <circle cx="264" cy="126" r="6" fill="#fff" stroke="#24b47e" strokeWidth="3" />
      <g transform="translate(236 196)">
        <rect width="104" height="64" rx="16" fill="#c8923a" />
        <path d="M30 28v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" transform="translate(12 -2)" />
        <rect x="26" y="26" width="26" height="20" rx="5" fill="#fff" transform="translate(12 0)" />
        <g fill="#0f2229"><circle cx="82" cy="36" r="3" /><circle cx="92" cy="36" r="3" /></g>
      </g>
    </svg>
  );
}
