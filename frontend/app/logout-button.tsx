"use client";

import { useRouter } from "next/navigation";
import { store } from "@/lib/api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        store.pin = "";
        store.staffToken = "";
        router.push("/");
        router.refresh();
      }}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-dim transition hover:border-plum hover:text-plum"
    >
      Log out
    </button>
  );
}
