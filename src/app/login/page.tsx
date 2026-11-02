import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { getViewer } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/policy";
import { getMessages } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer.role));

  const { lang, t } = await getMessages();
  const demo = process.env.DEMO_MODE === "true";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <LanguageToggle lang={lang} t={t.app} />
      </header>

      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-[26px] font-semibold tracking-tight">{t.login.title}</h1>
        <p className="mt-1 mb-7 text-[15px] text-ink-2">{t.login.subtitle}</p>
        <LoginForm
          t={t.login}
          demoAccounts={
            demo
              ? [
                  { label: t.login.demoRetailer, phone: "919000000001", detail: "Sharma Kirana Store · Wright Town" },
                  { label: t.login.demoRetailer, phone: "919000000002", detail: "Gupta General Stores · near credit limit" },
                  { label: t.login.demoDesk, phone: "919000000100", detail: "Neha Soni · order desk" },
                ]
              : null
          }
        />
      </div>

      {demo && <p className="text-center text-[13px] text-ink-3">{t.app.demoBanner}</p>}
    </main>
  );
}
