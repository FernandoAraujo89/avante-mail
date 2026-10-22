import { AvanteLogo } from "@/components/avante-logo";
import { LoginForm } from "@/components/login-form";
import { googleConfigurado } from "@/lib/auth/google";
import { ERROS_DE_LOGIN } from "@/lib/auth/google-regras";

export const metadata = {
  title: "Entrar",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <AvanteLogo type="horizontal" variant="blue" height={30} />
          <p className="text-sm text-muted-foreground">
            E-mail marketing para parceiros
          </p>
        </div>
        <LoginForm
          google={googleConfigurado()}
          erroInicial={erro ? (ERROS_DE_LOGIN[erro] ?? ERROS_DE_LOGIN.google) : ""}
        />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
