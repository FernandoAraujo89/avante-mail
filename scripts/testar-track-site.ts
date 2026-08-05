// Conferência das regras puras do rastreio de site (fase E).
// É a camada onde um erro VAZA DADO DE PESSOA — allowlist de destino do token,
// normalização de caminho e saneamento do que vem do navegador. Roda sem banco
// e sem rede: `npx tsx scripts/testar-track-site.ts`
//
// Não se chama migrate-* de propósito: o deploy roda todos os migrate-*.ts.

process.env.SITE_TRACK_ORIGINS =
  "https://avantejuntos.com.br, https://www.avantejuntos.com.br/";
import {
  hostPermitido,
  origemPermitida,
  anexarToken,
  normalizarPath,
  slugEvento,
  textoSeguro,
  hostDoReferrer,
  sessaoSegura,
} from "../lib/track/site";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) {
    falhas++;
    console.log(
      `  X ${nome}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`
    );
  } else console.log(`  ok ${nome}`);
}

console.log("— allowlist de destino (o token só pode ir para os nossos):");
ok("nosso domínio", hostPermitido("https://avantejuntos.com.br/planos"), true);
ok("www também", hostPermitido("https://www.avantejuntos.com.br/x"), true);
ok("terceiro NAO", hostPermitido("https://evil.com/x"), false);
ok(
  "sufixo enganoso NAO",
  hostPermitido("https://avantejuntos.com.br.evil.com/"),
  false
);
ok(
  "subdominio nao listado NAO",
  hostPermitido("https://blog.avantejuntos.com.br/"),
  false
);
ok("http do mesmo host NAO", hostPermitido("http://avantejuntos.com.br/"), false);
ok("javascript: NAO", hostPermitido("javascript:alert(1)"), false);
ok("lixo NAO", hostPermitido("nao e url"), false);

console.log("— CORS (origem exata):");
ok(
  "origem listada",
  origemPermitida("https://avantejuntos.com.br"),
  "https://avantejuntos.com.br"
);
ok(
  "origem com barra",
  origemPermitida("https://www.avantejuntos.com.br/"),
  "https://www.avantejuntos.com.br"
);
ok("origem estranha", origemPermitida("https://evil.com"), null);
ok("sem cabecalho", origemPermitida(null), null);

console.log("— anexar token sem quebrar o link:");
ok(
  "query existente preservada",
  anexarToken("https://a.com/p?plano=pro", "T"),
  "https://a.com/p?plano=pro&av=T"
);
ok(
  "ancora preservada (token NAO vai pro fragmento)",
  anexarToken("https://a.com/p#planos", "T"),
  "https://a.com/p?av=T#planos"
);
ok(
  "av ja presente e substituido",
  anexarToken("https://a.com/p?av=velho", "novo"),
  "https://a.com/p?av=novo"
);

console.log("— normalizacao de caminho (casa com a regra de pontuacao):");
ok("maiusculas", normalizarPath("/Planos"), "/planos");
ok("barra final", normalizarPath("/planos/"), "/planos");
ok("query fora", normalizarPath("/planos?av=SEGREDO&x=1"), "/planos");
ok("fragmento fora", normalizarPath("/planos#topo"), "/planos");
ok(
  "URL completa vira caminho",
  normalizarPath("https://avantejuntos.com.br/Planos/?av=X"),
  "/planos"
);
ok("raiz", normalizarPath("/"), "/");
ok("barras duplicadas", normalizarPath("//a//b//"), "/a/b");
ok("sem barra inicial", normalizarPath("planos"), "/planos");
ok("vazio", normalizarPath(""), null);
ok("nao-string", normalizarPath(42), null);

console.log("— nome de evento:");
ok("valido", slugEvento("pediu-demo"), "pediu-demo");
ok("normaliza caixa", slugEvento(" DEMO "), "demo");
ok("espaco no meio recusa", slugEvento("viu precos"), null);
ok("injecao recusa", slugEvento("<script>"), null);
ok("longo demais recusa", slugEvento("a".repeat(41)), null);

console.log("— texto e referrer:");
ok("controle vira espaco", textoSeguro("a b\u0007c", 50), "a b c");
ok("trunca", textoSeguro("x".repeat(200), 10), "xxxxxxxxxx");
ok(
  "so o host",
  hostDoReferrer("https://instagram.com/p/abc?utm=zz"),
  "instagram.com"
);
ok("referrer invalido", hostDoReferrer("nada"), null);
ok("sessao valida", sessaoSegura("s_9f3aBC-12"), "s_9f3aBC-12");
ok("sessao com injecao", sessaoSegura("../../etc"), null);

console.log(falhas === 0 ? "TUDO PASSOU" : `${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
