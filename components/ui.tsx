import type { Trend } from "@/lib/windsor";
import { pct } from "@/lib/format";

export function TrendPill({ t, className = "" }: { t: Trend; className?: string }) {
  if (!t) return <span className={`text-[11px] text-[var(--muted-2)] ${className}`}>—</span>;
  const color = t.good ? "var(--emerald)" : "var(--rose)";
  const arrow = t.dir === "up" ? "▲" : t.dir === "down" ? "▼" : "■";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold tnum ${className}`}
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="text-[8px] leading-none">{arrow}</span>
      {pct(Math.abs(t.value))}
    </span>
  );
}

export function Sparkline({ data, color = "var(--accent)", height = 38 }: { data: number[]; color?: string; height?: number }) {
  const w = 120;
  const h = height;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = w / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => [i * step, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `sg-${color.replace(/[^a-z]/gi, "")}-${data.length}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiCard({
  label, value, sub, trend, spark, sparkColor, accent = false, delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: Trend;
  spark?: number[];
  sparkColor?: string;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <div
      className="panel fade-up relative overflow-hidden p-4 sm:p-5"
      style={{ animationDelay: `${delay}ms`, ...(accent ? { borderColor: "color-mix(in srgb, var(--accent) 45%, var(--border))" } : {}) }}
    >
      {accent && (
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%)" }} />
      )}
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</span>
        {trend !== undefined && <TrendPill t={trend} />}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-[26px] font-semibold leading-none tnum sm:text-[30px]">{value}</div>
          {sub && <div className="mt-1.5 text-[12px] text-[var(--muted-2)] tnum">{sub}</div>}
        </div>
        {spark && (
          <div className="w-[120px] shrink-0 self-end opacity-90">
            <Sparkline data={spark} color={sparkColor ?? (accent ? "var(--accent)" : "var(--cyan)")} />
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-lg text-[14px]" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}>{icon}</span>
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {hint && <span className="text-[12px] text-[var(--muted-2)]">· {hint}</span>}
    </div>
  );
}

export function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel-soft p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tnum">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{hint}</div>}
    </div>
  );
}
