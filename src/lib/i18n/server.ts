import "server-only";
import { cookies } from "next/headers";
import { MESSAGES, type Lang, type Messages } from "./messages";

export const LANG_COOKIE = "vf_lang";

export async function getLang(): Promise<Lang> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return value === "hi" ? "hi" : "en";
}

export async function getMessages(): Promise<{ lang: Lang; t: Messages }> {
  const lang = await getLang();
  return { lang, t: MESSAGES[lang] };
}
