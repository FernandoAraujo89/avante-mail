// Conferência da defesa contra SSRF do webhook de saída (fase F).
// É a camada onde um erro faz o SERVIDOR chamar a rede interna — Postgres,
// Redis e serviço de metadados da nuvem estão todos a um nome de host de
// distância. Roda sem banco: `npx tsx scripts/testar-webhook-saida.ts`

// Hosts que RESOLVEM de verdade: a validação consulta o DNS, então uma lista
// com nome inexistente testaria só metade da defesa. (`hook.make.com` puro não
// existe — o host real do Make tem a região: hook.eu1.make.com.)
process.env.WEBHOOK_SAIDA_HOSTS = "make.com, google.com";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "segredo-de-teste";

import { assinar, hostsPermitidos, validarDestino } from "../lib/automations/webhook-saida";
import { montarCorpo } from "../lib/automations/webhook-passo";

let falhas = 0;
async function recusa(nome: string, url: string) {
  const r = await validarDestino(url);
  if (r.ok) {
    falhas++;
    console.log(`  X ${nome}: DEVERIA RECUSAR — ${url}`);
  } else {
    console.log(`  ok ${nome} (${r.motivo.slice(0, 58)})`);
  }
}
async function aceita(nome: string, url: string) {
  const r = await validarDestino(url);
  if (!r.ok) {
    falhas++;
    console.log(`  X ${nome}: DEVERIA ACEITAR — ${r.motivo}`);
  } else console.log(`  ok ${nome}`);
}

async function main() {
  console.log("hosts autorizados:", hostsPermitidos());

  console.log("— rede interna (o coração do SSRF):");
  await recusa("localhost", "https://localhost/x");
  await recusa("127.0.0.1", "https://127.0.0.1/x");
  await recusa("0.0.0.0", "https://0.0.0.0/x");
  await recusa("10.x privada", "https://10.0.0.5/x");
  await recusa("172.16 privada", "https://172.16.0.1/x");
  await recusa("192.168 privada", "https://192.168.1.1/x");
  await recusa("metadados da nuvem", "https://169.254.169.254/latest/meta-data/");
  await recusa("IPv6 loopback", "https://[::1]/x");
  await recusa("serviço do docker (db)", "https://db:5432/");
  await recusa("serviço do docker (redis)", "https://redis:6379/");

  console.log("— protocolo e forma:");
  await recusa("http simples", "http://make.com/abc");
  await recusa("file://", "file:///etc/passwd");
  await recusa("gopher://", "gopher://make.com/");
  await recusa("usuario embutido na URL", "https://make.com@evil.com/x");
  await recusa("lixo", "nao e url");

  console.log("— allowlist:");
  await recusa("host fora da lista", "https://evil.com/x");
  await recusa("sufixo enganoso", "https://make.com.evil.com/x");
  await aceita("host exato da lista", "https://make.com/abc123");
  await aceita("subdominio do permitido", "https://www.google.com/x");

  console.log("— assinatura:");
  const corpo = JSON.stringify({ a: 1 });
  const s1 = assinar(corpo);
  const s2 = assinar(corpo);
  const s3 = assinar(JSON.stringify({ a: 2 }));
  console.log(
    s1 === s2 && s1 !== s3 ? "  ok estável e sensível ao corpo" : "  X assinatura inconsistente"
  );
  if (!(s1 === s2 && s1 !== s3)) falhas++;

  console.log("— corpo enviado ao Make:");
  const corpoMontado = montarCorpo(
    "lead-quente",
    {
      id: "c-1", name: "Maria", email: "maria@x.com", phone: "+5531999998888",
      company: "Empresa", stage: "nutrindo", tags: ["lead"], leadScore: 62,
      leadScoreBand: "quente", sourceChannel: "instagram", utmSource: "instagram",
      utmMedium: "social", utmCampaign: "agosto", subscribed: true,
      emailOptOutAt: null, whatsappSubscribed: true,
    } as never,
    "run-1"
  );
  console.log(JSON.stringify(corpoMontado, null, 1).split("\n").map((l) => "  " + l).join("\n"));

  const texto = JSON.stringify(corpoMontado);
  const vazouSegredo = /JWT_SECRET|token|senha|password/i.test(texto);
  console.log(vazouSegredo ? "  X corpo carrega algo que não devia" : "  ok nada de segredo no corpo");
  if (vazouSegredo) falhas++;

  console.log(falhas === 0 ? "TUDO PASSOU" : `${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
