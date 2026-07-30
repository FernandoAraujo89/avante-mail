// Diagnóstico/teste de envio do WhatsApp — usa as envs WHATSAPP_* do contêiner
// (mesmo endpoint da Cloud API que o worker usa). Não imprime o token.
// Uso: node scripts/send-whatsapp-test.mjs <telefone> [template] [idioma]

const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const to = process.argv[2] || "5531995650622";
const template = process.argv[3] || "hello_world";
const language = process.argv[4] || "en_US";
// Args extras (a partir do 5º) viram parâmetros do corpo ({{1}}, {{2}}...).
const bodyParams = process.argv.slice(5);
const components =
  bodyParams.length > 0
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
    : [];

console.log(
  `config: version=${version} phoneNumberId=${phoneId} tokenLen=${(token || "").length}`
);

if (!phoneId || !token) {
  console.error("Faltam WHATSAPP_PHONE_NUMBER_ID e/ou WHATSAPP_ACCESS_TOKEN no ambiente.");
  process.exit(1);
}

const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: language },
      ...(components.length > 0 ? { components } : {}),
    },
  }),
});

const json = await res.json().catch(() => ({}));
console.log("HTTP", res.status);
console.log(JSON.stringify(json, null, 2));
