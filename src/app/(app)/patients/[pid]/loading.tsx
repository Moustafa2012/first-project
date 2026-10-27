export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="loading">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" style={{ width: "62%" }} />
      <div className="grid cols-3" style={{ marginBlockStart: "1.25rem" }}>
        <div className="skeleton sk-tile" /><div className="skeleton sk-tile" /><div className="skeleton sk-tile" />
      </div>
      <div className="grid cols-2" style={{ marginBlockStart: "1rem" }}>
        <div className="skeleton sk-card" /><div className="skeleton sk-card" />
      </div>
    </div>
  );
}
