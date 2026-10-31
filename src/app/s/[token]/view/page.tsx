import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { ShareViewer } from "@/components/share/ShareViewer";
import type { Bundle } from "@/lib/share-types";
import { contribState } from "@/lib/share-contrib";
import type { ShareDental } from "@/lib/share-types";
import type { ClinicalContextData } from "@/lib/clinical-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShareView({ params, searchParams }: { params: { token: string }; searchParams: Record<string, string | undefined> }) {
  if (!validToken(params.token)) notFound();
  const session = getShareSession(params.token);
  if (!session) redirect(`/s/${params.token}`);
  const { ipHash, ua } = clientMeta();
  // the database re-checks revocation, expiry and scope on every request
  const { data } = await createAdminClient().rpc("share_bundle", { p_session_token: session, p_ip_hash: ipHash, p_user_agent: ua });
  const b = data as (Bundle | { status: string }) | null;
  if (!b || b.status !== "ok") redirect(`/s/${params.token}?expired=1`);
  const admin = createAdminClient();
  const [st, { data: dental }, { data: context }] = await Promise.all([contribState(session), admin.rpc("share_dental", { p_session_token: session }),
    admin.rpc("share_context", { p_session_token: session })]);
  const dent = dental as ShareDental | null;
  const ctx = context as (ClinicalContextData & { status: string; specialties: string[] | null }) | null;
  return <ShareViewer b={b as Bundle} token={params.token} contrib={st.status === "ok" ? st : null} dental={dent?.status === "ok" ? dent : null} ctx={ctx?.status === "ok" ? ctx : null}
    uploaded={searchParams.uploaded === "1"} uploadError={searchParams.upload_error} />;
}
