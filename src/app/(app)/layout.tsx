import { currentProfile, requireUser } from "@/lib/auth";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const profile = await currentProfile();
  return (
    <>
      <Topbar signedIn admin={profile?.role === "admin"} />
      <main id="main" className="container">{children}</main>
      <Footer />
    </>
  );
}
