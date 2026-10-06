// Os endereços como chegam no corpo das requisições de contato, nos dois
// formatos que o sistema aceita:
//   novo:   emails: [{ email, subscribed? }], phones: [{ phone, whatsapp?, sms? }]
//           (cada item pode ser só a string; as chaves whatsappSubscribed e
//           smsSubscribed, do formato que a API devolve, também valem);
//   antigo: email, phone (strings) + subscribed, whatsappSubscribed,
//           smsSubscribed — um endereço de cada, como era antes dos múltiplos.
import type { EmailEntrada, TelefoneEntrada } from "@/lib/contatos/enderecos";
import { normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/utils";

export class EnderecoInvalido extends Error {
  constructor(public readonly tipo: "email" | "telefone") {
    super(
      tipo === "email"
        ? "Informe um e-mail válido."
        : "Informe um telefone válido com DDD (ex.: 48 99999-9999)."
    );
  }
}

export interface EnderecosDoCorpo {
  /** Ausente = o corpo não falou de e-mails (a edição mantém os que há). */
  emails?: EmailEntrada[];
  phones?: TelefoneEntrada[];
  /** Veio no formato antigo (um endereço de cada): a edição troca só o principal. */
  legado: boolean;
}

function lerBool(valor: unknown): boolean | undefined {
  return typeof valor === "boolean" ? valor : undefined;
}

function campo(item: unknown, chave: string): unknown {
  return item && typeof item === "object"
    ? (item as Record<string, unknown>)[chave]
    : undefined;
}

export function lerEnderecosDoCorpo(
  body: Record<string, unknown>
): EnderecosDoCorpo {
  const out: EnderecosDoCorpo = { legado: false };

  if (Array.isArray(body.emails)) {
    out.emails = body.emails.map((item) => {
      const cru = typeof item === "string" ? item : campo(item, "email");
      const email = normalizeEmail(cru);
      if (!email) throw new EnderecoInvalido("email");
      return { email, subscribed: lerBool(campo(item, "subscribed")) };
    });
  } else if (typeof body.email === "string") {
    out.legado = true;
    const texto = body.email.trim();
    if (texto) {
      const email = normalizeEmail(texto);
      if (!email) throw new EnderecoInvalido("email");
      out.emails = [{ email, subscribed: lerBool(body.subscribed) }];
    } else {
      out.emails = [];
    }
  }

  if (Array.isArray(body.phones)) {
    out.phones = body.phones.map((item) => {
      const cru = typeof item === "string" ? item : campo(item, "phone");
      const phone = normalizePhone(cru);
      if (!phone) throw new EnderecoInvalido("telefone");
      return {
        phone,
        whatsapp:
          lerBool(campo(item, "whatsapp")) ??
          lerBool(campo(item, "whatsappSubscribed")),
        sms:
          lerBool(campo(item, "sms")) ?? lerBool(campo(item, "smsSubscribed")),
      };
    });
  } else if (typeof body.phone === "string") {
    out.legado = true;
    const texto = body.phone.trim();
    if (texto) {
      const phone = normalizePhone(texto);
      if (!phone) throw new EnderecoInvalido("telefone");
      out.phones = [
        {
          phone,
          whatsapp: lerBool(body.whatsappSubscribed),
          sms: lerBool(body.smsSubscribed),
        },
      ];
    } else {
      out.phones = [];
    }
  } else if (out.legado) {
    // Formato antigo sem telefone, mas com as caixas de consentimento: elas
    // valem para o telefone principal que já existe.
    const whatsapp = lerBool(body.whatsappSubscribed);
    const sms = lerBool(body.smsSubscribed);
    if (whatsapp !== undefined || sms !== undefined) {
      out.phones = [{ phone: "", whatsapp, sms }];
    }
  }

  return out;
}
