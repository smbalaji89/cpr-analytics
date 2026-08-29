import { isPrivileged } from "@/lib/auth/access";
import { SiteNav } from "@/components/site-nav";

/**
 * Header shell.
 *
 * A server component purely so it can read the access cookie; the interactive
 * nav underneath stays a client component. Splitting it this way means every
 * page keeps rendering `<SiteHeader />` with no argument and still gets the
 * right nav for the requesting device.
 */
export async function SiteHeader() {
  const privileged = await isPrivileged();
  return <SiteNav privileged={privileged} />;
}
