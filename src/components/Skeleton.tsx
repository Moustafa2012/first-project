/** Loading placeholders shaped like the content they stand in for (no layout shift when data arrives). */
const S = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => <div className={`skeleton ${className}`} style={style} />;

function Frame({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div role="status" aria-busy="true" aria-label={label ?? "loading"} className="stack">{children}</div>;
}

export const SkelHead = () => (
  <div><S className="sk-title" /><S className="sk-line" style={{ width: "58%" }} /></div>
);
export const SkelTiles = ({ n = 3 }: { n?: number }) => (
  <div className="grid cols-3">{Array.from({ length: n }, (_, i) => <S key={i} className="sk-tile" />)}</div>
);
export const SkelCards = ({ n = 2 }: { n?: number }) => (
  <div className="grid cols-2">{Array.from({ length: n }, (_, i) => <S key={i} className="sk-card" />)}</div>
);
export const SkelRows = ({ n = 5 }: { n?: number }) => (
  <div className="card stack" style={{ gap: ".6rem" }}>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
        <S className="sk-dot" /><div style={{ flex: 1 }}><S className="sk-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} /><S className="sk-line sm" style={{ width: `${30 + ((i * 11) % 25)}%` }} /></div>
      </div>
    ))}
  </div>
);
export const SkelChart = () => <div className="card"><S className="sk-line" style={{ width: "30%" }} /><S className="sk-chart" /></div>;

export const SkelOverview = () => <Frame><SkelHead /><SkelTiles n={3} /><SkelTiles n={3} /><SkelCards /><SkelRows n={4} /></Frame>;
export const SkelList = () => <Frame><SkelHead /><SkelRows n={5} /></Frame>;
export const SkelVitals = () => <Frame><SkelHead /><SkelTiles n={3} /><SkelChart /><SkelRows n={4} /></Frame>;
export const SkelPatients = () => <Frame><SkelHead /><div className="grid cols-3">{Array.from({ length: 3 }, (_, i) => <S key={i} className="sk-card" style={{ height: 120 }} />)}</div></Frame>;
export const SkelForm = () => <Frame><SkelHead /><div className="card stack"><S className="sk-input" /><S className="sk-input" /><S className="sk-input" /></div></Frame>;
