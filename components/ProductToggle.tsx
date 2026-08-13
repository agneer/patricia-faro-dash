"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Destaque no topo: alterna o produto (ex.: GERAL | GPS | SPL). Troca o escopo
// inteiro do dashboard — gasto + criativos + vendas.
export function ProductToggle({ products, current }: { products: { key: string; label: string }[]; current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (key: string) => {
    const p = new URLSearchParams(params.toString());
    if (key === "geral") p.delete("product");
    else p.set("product", key);
    p.delete("campaign"); // campanhas são específicas do produto
    start(() => router.push(`/?${p.toString()}`, { scroll: false }));
  };

  const opts = [{ key: "geral", label: "GERAL" }, ...products];

  return (
    <div className="fade-up mb-3 flex items-center gap-3" style={{ opacity: pending ? 0.6 : 1 }}>
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-2)]">Produto</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-1.5">
        {opts.map((o) => {
          const active = current === o.key;
          return (
            <button
              key={o.key}
              onClick={() => go(o.key)}
              className="rounded-xl px-5 py-2.5 text-[14px] font-bold tracking-wide transition-all"
              style={active
                ? { background: "linear-gradient(180deg,var(--accent),var(--accent-2))", color: "#fff", boxShadow: "0 6px 20px color-mix(in srgb,var(--accent) 45%,transparent)" }
                : { color: "var(--muted)" }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
