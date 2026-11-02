import { ButtonLink } from "@/components/ui";
import { getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getMessages();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="text-xl font-semibold">{t.common.notFoundTitle}</h1>
      <p className="mt-2 text-[15px] text-ink-2">{t.common.notFoundBody}</p>
      <ButtonLink href="/" className="mt-6">
        {t.common.goHome}
      </ButtonLink>
    </main>
  );
}
