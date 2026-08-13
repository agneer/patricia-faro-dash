export const brl = (n: number, frac = 2) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: frac, maximumFractionDigits: frac });

export const num = (n: number, frac = 0) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: frac, maximumFractionDigits: frac });

export const pct = (n: number, frac = 1) =>
  `${((n || 0) * 100).toLocaleString("pt-BR", { minimumFractionDigits: frac, maximumFractionDigits: frac })}%`;

export const compact = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
