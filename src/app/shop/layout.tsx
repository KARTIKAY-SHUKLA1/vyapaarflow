import { eq } from "drizzle-orm";
import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out";
import { db } from "@/db";
import { retailers } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";

export default async function ShopLayout({ children }: LayoutProps<"/shop">) {
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const [shop] = await db
    .select({ shopName: retailers.shopName })
    .from(retailers)
    .where(eq(retailers.id, viewer.retailerId!));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo compact />
            <span className="truncate text-[15px] font-semibold">{shop?.shopName}</span>
          </div>
          <div className="flex shrink-0 items-center">
            <LanguageToggle lang={lang} t={t.app} />
            <SignOutButton label={t.app.signOut} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
