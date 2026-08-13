"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function TaxToggle({ active, rate }: { active: boolean; rate: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const toggle = (on: boolean) => {
    const p = new URLSearchParams(params.toString());
    if (on) p.set("tax", "1");
    else p.delete("tax");
    start(() => router.push(`/?${p.toString()}`, { scroll: false }));
  };

  const ratePct = `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-1" style={{ opacity: pending ? 0.6 : 1 }}>
      <span className="pl-1.5 text-[11px] font-medium text-[var(--muted-2)]">Imposto {ratePct}</span>
      <div className="flex items-center">
        <button
          onClick={() => toggle(false)}
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all"
          style={!active ? { background: "linear-gradient(180deg,var(--accent),var(--accent-2))", color: "#fff", boxShadow: "0 4px 14px color-mix(in srgb,var(--accent) 40%,transparent)" } : { color: "var(--muted)" }}
        >
          Sem
        </button>
        <button
          onClick={() => toggle(true)}
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all"
          style={active ? { background: "linear-gradient(180deg,var(--amber),#f59e0b)", color: "#1a1206", boxShadow: "0 4px 14px color-mix(in srgb,var(--amber) 40%,transparent)" } : { color: "var(--muted)" }}
        >
          Com
        </button>
      </div>
    </div>
  );
}
