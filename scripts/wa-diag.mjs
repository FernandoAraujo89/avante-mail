// Diagnóstico do token do WhatsApp: mostra o que o token consegue acessar.
// Não imprime o token. Uso: node scripts/wa-diag.mjs

const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const wabaId = process.env.WHATSAPP_WABA_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;

async function get(pathAndQuery, label) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${pathAndQuery}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await res.json().catch(() => ({}));
    console.log(`\n[${label}] HTTP ${res.status}`);
    console.log(JSON.stringify(j, null, 2));
  } catch (e) {
    console.log(`\n[${label}] erro de rede: ${e.message}`);
  }
}

console.log(
  `version=${version} phoneId=${phoneId} wabaId=${wabaId} tokenLen=${(token || "").length}`
);

await get("me?fields=id,name", "identidade do token");
await get(
  `${phoneId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,platform_type`,
  "acesso ao numero de teste"
);
await get(`${wabaId}/phone_numbers`, "numeros da WABA de teste (1504)");
await get(
  "748303747693162?fields=name,currency,account_review_status,timezone_id",
  "acesso a WABA REAL (748)"
);
await get(
  "748303747693162/phone_numbers?fields=display_phone_number,verified_name,id",
  "numeros da WABA REAL (748)"
);
await get("me/businesses?fields=id,name,verification_status", "negocios que o token enxerga");
