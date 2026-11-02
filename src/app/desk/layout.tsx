import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";

export default async function DeskLayout({ children }: LayoutProps<"/desk">) {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="hidden text-[15px] text-ink-3 sm:inline">/ {t.desk.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden px-2 text-[15px] text-ink-2 md:inline">{viewer.name}</span>
            <LanguageToggle lang={lang} t={t.app} />
            <SignOutButton label={t.app.signOut} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
