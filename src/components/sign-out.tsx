import { signOutAction } from "@/app/actions";

export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="h-11 rounded-md px-3 text-[15px] font-medium text-ink-2 hover:bg-sunken hover:text-ink"
      >
        {label}
      </button>
    </form>
  );
}
