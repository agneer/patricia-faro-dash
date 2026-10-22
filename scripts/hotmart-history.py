#!/usr/bin/env python3
"""Export de vendas da Hotmart (.xlsx ou .csv) → lib/hotmart-history.json SEM dados pessoais.

Uso:  python3 -I scripts/hotmart-history.py "<caminho do export>"

Guarda só transação, status, data, produto e valores (líquido = bruto − taxas da Hotmart). O e-mail do comprador é usado
APENAS em memória para ligar um upsell (UPSELL_RE) à compra principal do mesmo
comprador — vira `parent_transaction` e o upsell soma na venda principal no dash
(como order bump), sem contar como venda a mais. Nada pessoal vai para o arquivo.
O dash junta este histórico com as vendas do webhook (Supabase); o webhook vence.
"""
import csv, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

UPSELL_RE = re.compile(r"masterclass", re.I)  # produtos vendidos depois da compra principal
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib", "hotmart-history.json")

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    first = wb.find("m:sheets", NS)[0]  # aba "Report"
    target = rels[first.get("{%s}id" % NS["r"])].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    rows = []
    for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
        vals = {}
        for c in row.findall("m:c", NS):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group():
                col = col * 26 + ord(ch) - 64
            v, t = c.find("m:v", NS), c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                val = "" if v is None else (ss[int(v.text)] if t == "s" else v.text)
            vals[col - 1] = val
        if vals:
            rows.append([vals.get(i, "") for i in range(max(vals) + 1)])
    return rows


def read_csv(path):
    text = open(path, encoding="utf-8-sig").read()
    delim = ";" if text.split("\n", 1)[0].count(";") > text.split("\n", 1)[0].count(",") else ","
    return list(csv.reader(text.splitlines(), delimiter=delim))


def money(v):
    s = str(v or "").strip()
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def when(v):
    """'20/10/2026 10:44:48' (horário de Brasília) → ('2026-10-20', '2026-10-20T10:44:48-03:00')."""
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?", str(v or "").strip())
    if not m:
        return None, None
    d = f"{m[3]}-{m[2]}-{m[1]}"
    return d, f"{d}T{m[4] or '00'}:{m[5] or '00'}:{m[6] or '00'}-03:00"


def main(path):
    rows = read_xlsx(path) if path.lower().endswith(".xlsx") else read_csv(path)
    head, data = rows[0], rows[1:]
    ix = {h.strip(): i for i, h in enumerate(head)}
    need = ["Código da transação", "Status da transação", "Produto"]
    miss = [c for c in need if c not in ix]
    if miss:
        sys.exit(f"Colunas não encontradas: {miss}")
    g = lambda r, k: (r[ix[k]] if k in ix and ix[k] < len(r) else "").strip()

    sales, buyer_of = [], {}
    for r in data:
        tid = g(r, "Código da transação")
        status = g(r, "Status da transação").lower()
        if not tid:
            continue
        refunded = bool(re.search(r"reembol|estorn|cancel|chargeback|devolv|expirad", status))
        if not refunded and not re.search(r"aprova|complet|conclu", status):
            continue  # boleto impresso, aguardando pagamento etc. não são vendas
        date, at = when(g(r, "Confirmação do pagamento") or g(r, "Data da transação"))
        if not date:
            continue
        gross = money(g(r, "Faturamento bruto (sem impostos)") or g(r, "Valor de compra sem impostos"))
        # Líquido = bruto − taxas da Hotmart (processamento, streaming, outras). Comissão de
        # coprodutor/afiliado NÃO sai: é faturamento do negócio, só dividido depois.
        fees = sum(money(g(r, c)) for c in ("Taxa de processamento", "Taxa de streaming", "Outras Taxas"))
        net = round(gross - fees, 2) if fees else money(g(r, "Faturamento líquido do(a) Produtor(a)") or g(r, "Faturamento líquido"))
        parent = g(r, "Transação do Produto Principal")
        sales.append({
            "invoice_id": tid,
            "parent_transaction": parent if parent and parent != "(none)" and parent != tid else None,
            "order_bump": bool(parent and parent != "(none)" and parent != tid),
            "status": status,
            "refunded": refunded,
            "sale_date": date,
            "at": at,
            "gross_value": gross,
            "net_value": net,
            "product_name": g(r, "Produto"),
            "sck": None if g(r, "Código SCK") in ("", "(none)") else g(r, "Código SCK"),
            "utm_campaign": None, "utm_content": None, "utm_term": None,
        })
        buyer_of[tid] = g(r, "Email do(a) Comprador(a)").lower()  # só em memória

    # Upsell → compra principal mais recente do mesmo comprador até aquele momento.
    mains = [s for s in sales if not UPSELL_RE.search(s["product_name"]) and not s["order_bump"]]
    linked = 0
    for s in sales:
        if s["order_bump"] or not UPSELL_RE.search(s["product_name"]):
            continue
        email = buyer_of.get(s["invoice_id"])
        cands = [m for m in mains if email and buyer_of.get(m["invoice_id"]) == email and m["at"] <= s["at"]]
        if cands:
            s["parent_transaction"] = max(cands, key=lambda m: m["at"])["invoice_id"]
            s["order_bump"] = True
            linked += 1
    for s in sales:
        del s["at"]

    sales.sort(key=lambda s: (s["sale_date"], s["invoice_id"]))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps({"source": os.path.basename(path), "sales": sales}, ensure_ascii=False, separators=(",", ":")).replace("},{", "},\n{") + "\n")
    by = {}
    for s in sales:
        by[s["product_name"]] = by.get(s["product_name"], 0) + 1
    print(f"{len(sales)} vendas → lib/hotmart-history.json ({sales[0]['sale_date']} a {sales[-1]['sale_date']}); "
          f"upsells ligados à compra principal: {linked}; por produto: {by}")


if __name__ == "__main__":
    main(sys.argv[1])
