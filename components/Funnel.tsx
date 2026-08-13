import type { FunnelStage } from "@/lib/windsor";
import { num, pct } from "@/lib/format";

const COLORS = ["#6366f1", "#7c6cf2", "#9168ef", "#a855f7", "#22d3ee"];

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  // Ad funnels drop steeply (impressions ≫ purchases). A linear bar makes the
  // bottom stages invisible, so we use a perceptual (power) scale with a floor
  // that keeps every stage readable while preserving the visual ordering.
  const widthOf = (v: number) => Math.max(Math.pow(v / max, 0.4) * 100, 7);
  return (
    <div className="flex flex-col gap-1">
      {stages.map((s, i) => {
        const w = widthOf(s.value);
        const color = COLORS[i] ?? "#6366f1";
        return (
          <div key={s.key}>
            <div className="group relative">
              <div className="flex items-center justify-between px-1 pb-1.5 pt-0.5">
                <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {s.label}
                </span>
                <span className="tnum text-[14px] font-semibold">{num(s.value)}</span>
              </div>
              <div className="h-9 w-full overflow-hidden rounded-lg" style={{ background: "var(--bg-elev)" }}>
                <div
                  className="flex h-full items-center rounded-lg px-3 transition-all duration-700"
                  style={{ width: `${w}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, #0b1220))`, boxShadow: `0 0 18px color-mix(in srgb, ${color} 35%, transparent)` }}
                >
                  <span className="text-[11px] font-semibold text-white/90 tnum">
                    {i === 0 ? "100%" : pct(s.value / stages[0].value, s.value / stages[0].value < 0.01 ? 2 : 1)}
                  </span>
                </div>
              </div>
            </div>
            {i < stages.length - 1 && stages[i + 1].rate != null && (
              <div className="flex items-center justify-center py-1">
                <span className="rounded-full px-2 py-[2px] text-[11px] font-medium tnum" style={{ color: "var(--muted)", background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}>
                  ↓ {pct(stages[i + 1].rate as number, 1)}
                  <span className="ml-1 text-[var(--muted-2)]">{stages[i + 1].hint}</span>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
