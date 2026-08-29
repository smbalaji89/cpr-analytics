"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { lockDevice } from "@/app/unlock/actions";

/** Drops this browser back to the public view. */
export function LockDeviceButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await lockDevice();
          // The cached router tree still holds privileged markup.
          router.refresh();
          router.push("/");
        })
      }
    >
      {pending ? "Locking…" : "Lock this device"}
    </Button>
  );
}
