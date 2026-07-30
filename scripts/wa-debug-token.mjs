// Inspeciona as permissões (scopes) do token via debug_token.
// Usa o App Secret pra montar o app access token. Uso: node scripts/wa-debug-token.mjs
const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const appSecret = process.env.WHATSAPP_APP_SECRET;
const appId = process.argv[2] || "3644569289035449";
const appToken = `${appId}|${appSecret}`;

const res = await fetch(
  `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`
);
const j = await res.json().catch(() => ({}));
console.log("HTTP", res.status);
const d = j.data || {};
console.log("app_id:", d.app_id, "| type:", d.type, "| expira:", d.expires_at);
console.log("scopes:", JSON.stringify(d.scopes));
console.log("granular_scopes:", JSON.stringify(d.granular_scopes, null, 2));
if (j.error) console.log("erro:", JSON.stringify(j.error));
