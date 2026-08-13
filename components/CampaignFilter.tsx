"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function CampaignFilter({ campaigns, current }: { campaigns: { value: string; label: string }[]; current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const onChange = (value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value === "all") p.delete("campaign");
    else p.set("campaign", value);
    start(() => router.push(`/?${p.toString()}`, { scroll: false }));
  };

  return (
    <div className="relative inline-flex items-center" style={{ opacity: pending ? 0.6 : 1 }}>
      <span className="pointer-events-none absolute left-3 text-[12px] text-[var(--muted-2)]">🎯</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[260px] cursor-pointer appearance-none truncate rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] py-[9px] pl-8 pr-8 text-[12.5px] font-medium text-[var(--text)] [color-scheme:dark]"
        style={current !== "all" ? { borderColor: "color-mix(in srgb,var(--accent) 50%,var(--border))", color: "var(--text)" } : {}}
      >
        <option value="all">Todas as campanhas</option>
        {campaigns.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 text-[10px] text-[var(--muted)]">▼</span>
    </div>
  );
}
