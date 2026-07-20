import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  modules,
  templates,
  users,
  type NewContact,
} from "../lib/db";
import { hashPassword } from "../lib/passwords";
import { compileDesignToMjml } from "../lib/email-builder/compile";
import {
  createFooterModuleRow,
  createHeaderModuleRow,
} from "../lib/email-builder/presets";
import { FACTORY_TEMPLATE_DESIGNS } from "../lib/email-builder/template-designs";

const SEED_CONTACTS: NewContact[] = [
  { name: "Carlos Andrade", email: "contato@mercadinhosaojose.com.br", company: "Mercadinho São José", segment: "revenda_fiscal", tags: ["nfe", "pdv"] },
  { name: "Fernanda Lima", email: "fernanda@petshopamigofiel.com.br", company: "Pet Shop Amigo Fiel", segment: "white_label", tags: ["pet"] },
  { name: "Ricardo Souza", email: "ricardo@sabormineiro.com.br", company: "Restaurante Sabor Mineiro", segment: "white_label", tags: ["food", "pdv"] },
  { name: "Juliana Castro", email: "juliana@rotacerta.com.br", company: "Transportadora Rota Certa", segment: "revenda_fiscal", tags: ["ct-e", "fiscal"] },
  { name: "André Oliveira", email: "andre@paodourado.com.br", company: "Padaria Pão Dourado", segment: "white_label", tags: ["food"] },
  { name: "Patrícia Mendes", email: "patricia@campoverde.com.br", company: "Agropecuária Campo Verde", segment: "indicador", tags: ["pet", "pdv"] },
  { name: "Marcos Vieira", email: "marcos@autopecasvieira.com.br", company: "Auto Peças Vieira", segment: "revenda_fiscal", tags: ["nfe"] },
  { name: "Camila Rocha", email: "camila@farmaciabemestar.com.br", company: "Farmácia Bem Estar", segment: "indicador", tags: ["pdv"] },
  { name: "Bruno Cardoso", email: "bruno@boacompra.com.br", company: "Distribuidora Boa Compra", segment: "revenda_fiscal", tags: ["nfe", "fiscal"] },
  { name: "Aline Ferreira", email: "aline@boutiqueelegance.com.br", company: "Boutique Elegance", segment: "white_label", tags: ["pdv"] },
  { name: "Rodrigo Santos", email: "rodrigo@fornoalenha.com.br", company: "Pizzaria Forno a Lenha", segment: "white_label", tags: ["food"] },
  { name: "Tatiane Alves", email: "tatiane@vetamigo.com.br", company: "Clínica Vet Amigo", segment: "white_label", tags: ["pet"] },
  { name: "Gustavo Pereira", email: "gustavo@transporteshorizonte.com.br", company: "Transportes Horizonte", segment: "revenda_fiscal", tags: ["ct-e", "fiscal"] },
  { name: "Larissa Gomes", email: "larissa@graosabor.com.br", company: "Empório Grão Sabor", segment: "indicador", tags: ["food", "nfe"] },
  { name: "Felipe Martins", email: "felipe@martinstech.com.br", company: "Informática MartinsTech", segment: "indicador", tags: ["pdv", "nfe"] },
  { name: "Renata Dias", email: "renata@bomcorte.com.br", company: "Açougue Bom Corte", segment: "white_label", tags: ["food", "pdv"] },
  { name: "Eduardo Ramos", email: "eduardo@ramosefilhos.com.br", company: "Contabilidade Ramos & Filhos", segment: "revenda_fiscal", tags: ["fiscal", "nfe"] },
  { name: "Vanessa Costa", email: "vanessa@papelariacriativa.com.br", company: "Papelaria Criativa", segment: "indicador", tags: ["pdv"] },
  { name: "Thiago Barbosa", email: "thiago@mercadocentralformiga.com.br", company: "Mercado Central de Formiga", segment: "revenda_fiscal", tags: ["nfe", "pdv"], subscribed: false },
  { name: "Beatriz Nogueira", email: "beatriz@petiscariadoporto.com.br", company: "Petiscaria do Porto", segment: "white_label", tags: ["food", "pet"], subscribed: false },
];

async function main() {
  const db = getDb();

  console.log("🧹 Limpando tabelas...");
  await db.delete(campaignSends);
  await db.delete(campaigns);
  await db.delete(templates);
  await db.delete(contacts);
  await db.delete(modules);

  console.log("🔐 Criando usuário padrão (admin@avantejuntos.com.br / avante123)...");
  await db.delete(users);
  await db.insert(users).values({
    name: "Administrador",
    email: "admin@avantejuntos.com.br",
    passwordHash: hashPassword("avante123"),
  });

  console.log("👥 Inserindo 20 contatos...");
  await db.insert(contacts).values(SEED_CONTACTS);

  console.log("📄 Inserindo 4 templates (Criador de email)...");
  const insertedTemplates = await db
    .insert(templates)
    .values(
      FACTORY_TEMPLATE_DESIGNS.map((factory) => {
        const design = factory.design();
        return {
          name: factory.name,
          category: factory.category,
          design,
          editorType: "builder" as const,
          mjmlContent: compileDesignToMjml(design),
        };
      })
    )
    .returning({ id: templates.id, name: templates.name });

  console.log("🧩 Inserindo módulos do Criador de email...");
  await db.insert(modules).values([
    { name: "Header Avante", design: createHeaderModuleRow() },
    { name: "Footer Avante", design: createFooterModuleRow() },
  ]);

  console.log("📣 Inserindo 1 campanha rascunho...");
  await db.insert(campaigns).values({
    name: "Lançamento: Módulo Financeiro 2.0",
    subject: "Novidade: o financeiro do seu sistema ficou completo",
    preheader: "Fluxo de caixa, DRE e conciliação bancária no seu white label",
    body: "O módulo financeiro do sistema acaba de ganhar fluxo de caixa projetado, DRE gerencial e conciliação bancária automática.\n\nTudo já disponível na sua marca, sem custo adicional, para você oferecer ainda mais valor aos seus clientes.",
    ctaText: "Conhecer o módulo",
    ctaUrl: "https://avantejuntos.com.br/novidades/financeiro",
    templateId: insertedTemplates.find((t) => t.name === "Novidade de produto")!.id,
    segments: ["white_label"],
    tagsFilter: [],
    status: "draft",
  });

  console.log("");
  console.log("✅ Seed concluído:");
  console.log("   · 20 contatos (2 descadastrados, para testar a exclusão)");
  console.log(`   · ${insertedTemplates.length} templates do Criador de email`);
  console.log("   · 1 campanha em rascunho");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Erro no seed:", error);
    process.exit(1);
  });
