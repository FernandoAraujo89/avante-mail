import { AvanteLogo } from "@/components/avante-logo";
import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "Entrar",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <AvanteLogo type="horizontal" variant="blue" height={30} />
          <p className="text-sm text-muted-foreground">
            E-mail marketing para parceiros
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
