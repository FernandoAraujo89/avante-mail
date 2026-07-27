import { WhatsAppTemplateForm } from "@/components/whatsapp/template-form";

export default async function EditWhatsAppTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WhatsAppTemplateForm templateId={id} />;
}
