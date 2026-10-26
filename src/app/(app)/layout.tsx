import { currentProfile, requireUser } from "@/lib/auth";
import { Topbar } from "@/components/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const profile = await currentProfile();
  return (
    <>
      <Topbar signedIn admin={profile?.role === "admin"} />
      <main className="container">{children}</main>
    </>
  );
}
