import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proteção contra "version skew" (aba aberta com build antigo após um deploy):
  // com o deploymentId setado, quando a aba antiga clica num filtro e detecta que
  // o servidor está num deploy diferente, o Next faz uma navegação forçada e busca
  // a versão nova — sem ficar em branco/travado. Na Vercel a var já vem pronta.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,

  // Zera o cache do Router no cliente: toda troca de filtro busca dado fresco do
  // servidor (nada de servir um estado antigo/vazio de um clique anterior).
  experimental: {
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
