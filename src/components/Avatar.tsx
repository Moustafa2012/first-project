/* eslint-disable @next/next/no-img-element -- avatars are small private images served by /api/avatar */
/** Picture or initials. `src` points at /api/avatar (authorised per request); alt is empty because the name sits beside it. */
export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = Array.from(name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("") || "?").join("").toUpperCase();
  return (
    <span className={`avatar ${size === "sm" ? "sm" : size === "lg" ? "lg" : ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" className="avatar-img" loading="lazy" /> : initials}
    </span>
  );
}
