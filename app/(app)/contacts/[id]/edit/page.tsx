import { ContactForm } from "@/components/contacts/contact-form";

export const metadata = {
  title: "Editar contato",
};

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContactForm contactId={id} />;
}
