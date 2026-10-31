import { currentProfile, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { AppShell, globalNav } from "@/components/shell/AppShell";

export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const { t } = i18n();
  const authed = await requireUser();
  const profile = await currentProfile();
  const admin = profile?.role === "admin";
  return (
    <AppShell nav={globalNav(admin, t)} crumbs={[]}
      user={{ name: profile?.full_name ?? "", email: authed.email ?? "", admin, avatar: profile?.avatar_path ? `/api/avatar?v=${encodeURIComponent(profile.updated_at)}` : null }}>
      {children}
    </AppShell>
  );
}
