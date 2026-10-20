// Link do post de cada anúncio (botão "post↗"). Base = mapa do dataset (reserva);
// por cima, os links que o Windsor devolve ao vivo (todo criativo novo já entra com
// link); `creative-links.json` = override manual (vence).
import { POST_LINKS } from "./snapshot";
import MANUAL from "./creative-links.json";

export function resolvePostLinks(live: Record<string, string>): Record<string, string> {
  return { ...POST_LINKS, ...live, ...(MANUAL as Record<string, string>) };
}
