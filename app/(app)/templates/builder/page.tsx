import { EmailBuilder } from "@/components/builder/email-builder";

export const metadata = {
  title: "Criador de email",
};

export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <EmailBuilder key={id ?? "new"} templateId={id} />;
}
