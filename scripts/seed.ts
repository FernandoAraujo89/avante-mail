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
  { name: "Carlos Andrade", email: "contato@mercadinhosaojose.com.br", company: "Mercadinho São José", tags: ["nfe", "pdv"] },
  { name: "Fernanda Lima", email: "fernanda@petshopamigofiel.com.br", company: "Pet Shop Amigo Fiel", tags: ["pet"] },
  { name: "Ricardo Souza", email: "ricardo@sabormineiro.com.br", company: "Restaurante Sabor Mineiro", tags: ["food", "pdv"] },
  { name: "Juliana Castro", email: "juliana@rotacerta.com.br", company: "Transportadora Rota Certa", tags: ["ct-e", "fiscal"] },
  { name: "André Oliveira", email: "andre@paodourado.com.br", company: "Padaria Pão Dourado", tags: ["food"] },
  { name: "Patrícia Mendes", email: "patricia@campoverde.com.br", company: "Agropecuária Campo Verde", tags: ["pet", "pdv"] },
  { name: "Marcos Vieira", email: "marcos@autopecasvieira.com.br", company: "Auto Peças Vieira", tags: ["nfe"] },
  { name: "Camila Rocha", email: "camila@farmaciabemestar.com.br", company: "Farmácia Bem Estar", tags: ["pdv"] },
  { name: "Bruno Cardoso", email: "bruno@boacompra.com.br", company: "Distribuidora Boa Compra", tags: ["nfe", "fiscal"] },
  { name: "Aline Ferreira", email: "aline@boutiqueelegance.com.br", company: "Boutique Elegance", tags: ["pdv"] },
  { name: "Rodrigo Santos", email: "rodrigo@fornoalenha.com.br", company: "Pizzaria Forno a Lenha", tags: ["food"] },
  { name: "Tatiane Alves", email: "tatiane@vetamigo.com.br", company: "Clínica Vet Amigo", tags: ["pet"] },
  { name: "Gustavo Pereira", email: "gustavo@transporteshorizonte.com.br", company: "Transportes Horizonte", tags: ["ct-e", "fiscal"] },
  { name: "Larissa Gomes", email: "larissa@graosabor.com.br", company: "Empório Grão Sabor", tags: ["food", "nfe"] },
  { name: "Felipe Martins", email: "felipe@martinstech.com.br", company: "Informática MartinsTech", tags: ["pdv", "nfe"] },
  { name: "Renata Dias", email: "renata@bomcorte.com.br", company: "Açougue Bom Corte", tags: ["food", "pdv"] },
  { name: "Eduardo Ramos", email: "eduardo@ramosefilhos.com.br", company: "Contabilidade Ramos & Filhos", tags: ["fiscal", "nfe"] },
  { name: "Vanessa Costa", email: "vanessa@papelariacriativa.com.br", company: "Papelaria Criativa", tags: ["pdv"] },
  { name: "Thiago Barbosa", email: "thiago@mercadocentralformiga.com.br", company: "Mercado Central de Formiga", tags: ["nfe", "pdv"], subscribed: false },
  { name: "Beatriz Nogueira", email: "beatriz@petiscariadoporto.com.br", company: "Petiscaria do Porto", tags: ["food", "pet"], subscribed: false },
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
