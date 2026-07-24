import { AvanteLogo } from "@/components/avante-logo";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata = {
  title: "Redefinir senha",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <AvanteLogo type="horizontal" variant="blue" height={30} />
          <p className="text-sm text-muted-foreground">Redefinir senha</p>
        </div>
        <ResetPasswordForm token={token ?? ""} />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
