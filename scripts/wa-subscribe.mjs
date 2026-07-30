// Inscreve o app (do token) na WABA para mensageria, e lista o estado.
// Uso: node scripts/wa-subscribe.mjs
const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const wabaId = process.env.WHATSAPP_WABA_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const H = { Authorization: `Bearer ${token}` };

let res = await fetch(`https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`, { headers: H });
console.log("[subscribed_apps ANTES] HTTP", res.status);
console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));

res = await fetch(`https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`, { method: "POST", headers: H });
console.log("\n[POST subscribe] HTTP", res.status);
console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));

res = await fetch(`https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`, { headers: H });
console.log("\n[subscribed_apps DEPOIS] HTTP", res.status);
console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));
