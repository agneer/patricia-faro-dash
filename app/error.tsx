"use client";

import { useEffect } from "react";

// Auto-recuperação de "aba velha após deploy": quando o app é atualizado e a aba
// aberta clica num filtro, o Next pode dar erro de versão. Aqui recarregamos a
// página automaticamente pra buscar o build novo — com trava de 20s pra nunca
// entrar em loop se o erro for real e persistir.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const KEY = "dash-auto-reload-ts";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 20000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    } catch { /* sessionStorage indisponível — mostra o botão abaixo */ }
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-6">
      <div className="panel max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl text-[22px]" style={{ background: "color-mix(in srgb,var(--accent) 16%,transparent)" }}>↻</div>
        <h2 className="text-[17px] font-semibold text-[var(--text)]">Atualizando o painel…</h2>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          O dashboard foi atualizado. Estamos recarregando pra pegar a versão nova.
          Se não recarregar sozinho, clique abaixo.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white"
            style={{ background: "linear-gradient(180deg,var(--accent),var(--accent-2))" }}
          >
            Recarregar
          </button>
          <button
            onClick={() => reset()}
            className="rounded-xl border border-[var(--border-soft)] px-5 py-2.5 text-[13px] font-medium text-[var(--muted)]"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    </main>
  );
}
