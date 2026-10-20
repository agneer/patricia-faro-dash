"use client";

import { useState } from "react";
import Link from "next/link";

type Stats = { total: number; withUtm: number; fromCsv: number; fromWebhook: number; lastSale: string | null; webhookUrl: string };
type ImportResult = { ok: boolean; imported?: number; total?: number; utmCount?: number; detected?: Record<string, string | null>; error?: string; headers?: string[] };

const brDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function AdminPage() {
  const [pw, setPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  const loadStats = async (password = pw) => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/admin/stats", { headers: { "x-admin-password": password }, cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Erro"); setAuthed(false); return; }
      setStats(j); setAuthed(true);
    } catch { setErr("Falha de rede."); }
    finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!file) return;
    setErr(""); setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/admin/import", { method: "POST", headers: { "x-admin-password": pw }, body: fd });
      const j = await r.json();
      setResult(j);
      if (j.ok) loadStats();
      else setErr(j.error ?? "Erro na importação");
    } catch { setErr("Falha de rede no upload."); }
    finally { setBusy(false); }
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(stats?.webhookUrl ?? "");
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="mx-auto max-w-[860px] px-4 pb-20 pt-6 sm:px-6">
      <header className="fade-up mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl text-[18px]" style={{ background: "linear-gradient(140deg,var(--accent),var(--accent-2))" }}>⚙️</div>
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight">Administração · Vendas Hotmart</h1>
            <p className="text-[12px] text-[var(--muted)]">Importe o histórico por planilha e acompanhe o webhook</p>
          </div>
        </div>
        <Link href="/" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">← Dashboard</Link>
      </header>

      {!authed ? (
        <div className="panel fade-up mx-auto max-w-[420px] p-6">
          <h2 className="text-[15px] font-semibold">🔒 Acesso restrito</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">Digite a senha de administração (env <code>ADMIN_PASSWORD</code>).</p>
          <form onSubmit={(e) => { e.preventDefault(); loadStats(); }} className="mt-4 flex gap-2">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Senha" autoFocus
              className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] px-3 py-2 text-[13px] text-[var(--text)] [color-scheme:dark]" />
            <button disabled={busy} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white" style={{ background: "linear-gradient(180deg,var(--accent),var(--accent-2))" }}>{busy ? "..." : "Entrar"}</button>
          </form>
          {err && <p className="mt-3 text-[12px]" style={{ color: "var(--rose)" }}>{err}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Stats */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total de vendas", value: stats?.total ?? 0, color: "var(--accent)" },
              { label: "Com atribuição UTM", value: stats?.withUtm ?? 0, color: "var(--emerald)" },
              { label: "Via webhook", value: stats?.fromWebhook ?? 0, color: "var(--cyan)" },
              { label: "Via planilha", value: stats?.fromCsv ?? 0, color: "var(--amber)" },
            ].map((c) => (
              <div key={c.label} className="panel fade-up p-4">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">{c.label}</div>
                <div className="mt-1 text-[24px] font-semibold tnum" style={{ color: c.color }}>{c.value.toLocaleString("pt-BR")}</div>
              </div>
            ))}
          </section>

          {/* Webhook panel */}
          <section className="panel fade-up p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg text-[14px]" style={{ background: "color-mix(in srgb, var(--cyan) 16%, transparent)" }}>🔗</span>
              <h2 className="text-[15px] font-semibold">Webhook Hotmart</h2>
              <span className="ml-auto rounded-full px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--emerald)", background: "color-mix(in srgb,var(--emerald) 14%,transparent)" }}>● Ativo</span>
            </div>
            <p className="text-[12.5px] text-[var(--muted)]">URL do endpoint (cadastre na Hotmart → Ferramentas → Webhook, versão 2.0.0; o Hottok da tela vai em <code>HOTMART_HOTTOK</code> na Vercel):</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] px-3 py-2 text-[12px] text-[var(--text)]">{stats?.webhookUrl}</code>
              <button onClick={copyUrl} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[12px] text-[var(--muted)] hover:text-[var(--text)]">{copied ? "✓ Copiado" : "Copiar"}</button>
            </div>
            <p className="mt-2 text-[11.5px] text-[var(--muted-2)]">Última venda recebida: <span className="tnum text-[var(--muted)]">{brDateTime(stats?.lastSale ?? null)}</span></p>
          </section>

          {/* Import */}
          <section className="panel fade-up p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg text-[14px]" style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)" }}>📤</span>
              <h2 className="text-[15px] font-semibold">Importar histórico (planilha)</h2>
            </div>
            <p className="text-[12.5px] text-[var(--muted)]">Exporte as vendas na Hotmart (Vendas → Histórico → Exportar, CSV) e suba aqui. A importação é idempotente — reenviar não duplica (chave pelo código da transação).</p>

            <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--bg-elev)] px-4 py-8 text-center transition-colors hover:border-[var(--accent)]">
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
              <span className="text-[22px]">🗂️</span>
              <span className="text-[13px] font-medium text-[var(--text)]">{file ? file.name : "Clique ou arraste o arquivo CSV"}</span>
              {file && <span className="text-[11px] text-[var(--muted-2)]">{(file.size / 1024).toFixed(0)} KB</span>}
            </label>

            <button onClick={doImport} disabled={!file || busy}
              className="mt-3 w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
              style={{ background: "linear-gradient(180deg,var(--accent),var(--accent-2))" }}>
              {busy ? "Importando…" : "Importar vendas"}
            </button>

            {result && result.ok && (
              <div className="mt-4 rounded-xl p-4" style={{ background: "color-mix(in srgb,var(--emerald) 9%,transparent)", border: "1px solid color-mix(in srgb,var(--emerald) 25%,transparent)" }}>
                <p className="text-[13px] font-semibold" style={{ color: "var(--emerald)" }}>✓ {result.imported} vendas importadas</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">{result.utmCount} com UTM (atribuição por criativo) · {(result.total ?? 0) - (result.utmCount ?? 0)} sem UTM (só por dia)</p>
                <details className="mt-2 text-[11.5px] text-[var(--muted-2)]">
                  <summary className="cursor-pointer">Colunas detectadas</summary>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(result.detected ?? {}).map(([k, v]) => (
                      <li key={k}>{k}: <span style={{ color: v ? "var(--emerald)" : "var(--rose)" }}>{v ?? "não encontrada"}</span></li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            {result && !result.ok && (
              <div className="mt-4 rounded-xl p-4 text-[12.5px]" style={{ background: "color-mix(in srgb,var(--rose) 9%,transparent)", border: "1px solid color-mix(in srgb,var(--rose) 25%,transparent)", color: "var(--rose)" }}>
                {result.error}
                {result.headers && <p className="mt-2 text-[11px] text-[var(--muted)]">Cabeçalhos do arquivo: {result.headers.join(" · ")}</p>}
              </div>
            )}
          </section>

          {err && <p className="text-[12px]" style={{ color: "var(--rose)" }}>{err}</p>}
        </div>
      )}
    </main>
  );
}
