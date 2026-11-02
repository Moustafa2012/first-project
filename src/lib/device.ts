/** Approximate device of a sign-in, read from the browser's User-Agent. Never exact, never stored beyond a short label. */
export interface Device { browser: string | null; os: string | null; mobile: boolean }

type Tr = (ar: string, en: string) => string;

export function parseUserAgent(ua: string | null | undefined): Device {
  const s = String(ua ?? "").slice(0, 400);
  // order matters: Edge, Opera and Samsung Browser also say "Chrome"; Chrome also says "Safari"
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(s) ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(s) ? "Opera"
    : /\bSamsungBrowser\//.test(s) ? "Samsung Internet"
    : /\bFirefox\/|\bFxiOS\//.test(s) ? "Firefox"
    : /\b(?:Headless)?Chrome\/|\bCriOS\//.test(s) ? "Chrome"
    : /\bSafari\//.test(s) && /\bVersion\//.test(s) ? "Safari"
    : null;
  const os =
    /\bWindows\b/.test(s) ? "Windows"
    : /\b(iPhone|iPod)\b/.test(s) ? "iOS"
    : /\biPad\b/.test(s) ? "iPadOS"
    : /\bAndroid\b/.test(s) ? "Android"
    : /\bCrOS\b/.test(s) ? "ChromeOS"
    : /\bMac OS X\b|\bMacintosh\b/.test(s) ? "macOS"
    : /\bLinux\b|\bX11\b/.test(s) ? "Linux"
    : null;
  return { browser, os, mobile: /\bMobile\b|\biPhone\b|\biPod\b/.test(s) };
}

/** "Chrome on Windows" / "Chrome على Windows"; a plain "unknown device" when nothing could be told. */
export function deviceLabel(ua: string | null | undefined, t: Tr): string {
  const { browser, os } = parseUserAgent(ua);
  if (browser && os) return t(`${browser} على ${os}`, `${browser} on ${os}`);
  if (browser || os) return (browser ?? os) as string;
  return t("جهاز غير معروف", "Unknown device");
}
