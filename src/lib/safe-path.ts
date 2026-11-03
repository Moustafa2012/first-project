/**
 * A path on this site that is safe to redirect to: it starts with one "/" and has no backslash or control character.
 * Browsers read "//host" and "/\host" as another site.
 */
export const isLocalPath = (v: unknown): v is string => typeof v === "string" && /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/.test(v);
