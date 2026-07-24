import { AppShell } from "@/app/components/AppShell";
import { OwnerLock } from "@/app/components/OwnerLock";
import { requireOwnerPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DeskLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await requireOwnerPage("/");
  if (access.status === "owner_unconfigured" || access.status === "forbidden") {
    return <OwnerLock kind={access.status} email={access.user.email} />;
  }
  return (
    <AppShell
      user={{
        displayName: access.user.displayName,
        email: access.user.email,
      }}
      localDemo={access.localDemo}
    >
      {children}
    </AppShell>
  );
}
