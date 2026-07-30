// Registro/verificação do número na Cloud API.
// Uso: node scripts/wa-register.mjs request | verify <codigo> | register <pin>
const version = process.env.WHATSAPP_API_VERSION || "v23.0";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const action = process.argv[2];
const arg = process.argv[3];
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function post(path, body, label) {
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`[${label}] HTTP ${res.status}`);
  console.log(JSON.stringify(j, null, 2));
}

console.log(`phoneId=${phoneId} action=${action}`);

if (action === "request") {
  await post(`${phoneId}/request_code`, { code_method: "SMS", language: "pt_BR" }, "request_code (SMS)");
} else if (action === "verify") {
  await post(`${phoneId}/verify_code`, { code: String(arg) }, "verify_code");
} else if (action === "register") {
  await post(`${phoneId}/register`, { messaging_product: "whatsapp", pin: String(arg) }, "register");
} else {
  console.log("uso: request | verify <codigo> | register <pin>");
}
