import { AvanteLogo } from "@/components/avante-logo";
import { UnsubscribeCard } from "@/components/unsubscribe-card";

export const metadata = {
  title: "Descadastro",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center">
          <AvanteLogo type="symbol" variant="blue" height={28} />
        </div>

        <UnsubscribeCard token={token ?? ""} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
