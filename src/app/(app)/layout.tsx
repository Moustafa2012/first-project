import { requireUser } from "@/lib/auth";

/** Every page below needs a signed-in user; each part draws its own shell (general pages, or a patient's file). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
