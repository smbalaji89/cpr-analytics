import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isPrivileged } from "@/lib/auth/access";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = {
  title: "Unlock",
  // Nothing here should ever turn up in a search result.
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Per-device unlock.
 *
 * Reachable by anyone — hiding it would only stop the owner finding it. It
 * discloses nothing: with no key configured, or the wrong key submitted, the
 * response is the same either way.
 */
export default async function UnlockPage() {
  const privileged = await isPrivileged();

  return (
    <div className="min-h-dvh bg-surface-muted">
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Full access</CardTitle>
            <CardDescription>
              Unlocks system status and data provenance on this device only.
              Stored in a browser cookie, so each device is unlocked once.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            <UnlockForm alreadyUnlocked={privileged} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
