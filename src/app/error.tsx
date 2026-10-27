"use client";

import { TriangleAlert } from "lucide-react";

// Rendered when a page throws. No message detail is shown (it may contain internals); the digest lets support find the log line.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ar = typeof document !== "undefined" && document.documentElement.lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  return (
    <main id="main" className="container">
      <div className="state-page bad">
        <div>
          <div className="state-icon"><TriangleAlert size={34} aria-hidden="true" /></div>
          <h1>{t("حدث خطأ غير متوقع", "Something went wrong")}</h1>
          <p>{t("لم نتمكن من تحميل هذه الصفحة. بياناتك لم تتأثر. حاول مرة أخرى.", "We couldn't load this page. Your data is not affected. Please try again.")}</p>
          {error.digest && <p className="small"><span className="ltr">ref: {error.digest}</span></p>}
          <button className="btn primary" onClick={() => reset()}>{t("إعادة المحاولة", "Try again")}</button>
        </div>
      </div>
    </main>
  );
}
