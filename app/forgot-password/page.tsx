import { AvanteLogo } from "@/components/avante-logo";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata = {
  title: "Esqueci minha senha",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <AvanteLogo type="horizontal" variant="blue" height={30} />
          <p className="text-sm text-muted-foreground">Esqueci minha senha</p>
        </div>
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
