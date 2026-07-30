// Lista os modelos (templates) da WABA configurada. Uso: node scripts/wa-templates.mjs
const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const wabaId = process.env.WHATSAPP_WABA_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;

const res = await fetch(
  `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,status,language,category&limit=100`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const j = await res.json().catch(() => ({}));
console.log("HTTP", res.status);
if (j.data) {
  for (const t of j.data) {
    console.log(`- ${t.name} | ${t.language} | ${t.status} | ${t.category}`);
  }
  console.log(`(total: ${j.data.length})`);
} else {
  console.log(JSON.stringify(j, null, 2));
}
