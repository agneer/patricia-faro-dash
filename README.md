# ICF Tracker · Low Ticket

Painel de performance de Meta Ads para a conta **Grupo ICF - Lançamentos**, com dados do conector **Windsor.ai**. Reinterpreta a ideia do "The Tracker" com um UX mais limpo: hero de KPIs com tendência e sparkline, funil perceptual (impressão → compra), gráfico diário com dois eixos comparáveis, e tabelas ordenáveis de páginas/ofertas, temperatura de público e criativos.

## Rodar

```bash
npm install
npm run dev
# http://localhost:3000
```

Seletor de período: 7 / 14 / 30 dias (via `?range=`).

## Dados (Windsor.ai)

- **Sem chave:** usa o snapshot real de 30 dias embutido em `lib/snapshot.ts`, puxado do conector `facebook` (Meta Ads), conta `1358862781130238`.
- **Ao vivo:** defina `WINDSOR_API_KEY` (veja `.env.example`). O app passa a buscar os mesmos campos direto da API da Windsor a cada carga (revalida a cada 30 min) e cai no snapshot automaticamente se a API falhar.

A camada de dados fica em `lib/windsor.ts` (`getDashboardData` → fetch live com fallback → `buildDashboard`).

## Deploy

```bash
vercel        # preview
vercel --prod # produção  (lembre de setar WINDSOR_API_KEY no projeto)
```
