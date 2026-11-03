import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { mergeShareDental, type ShareExamExtras, type ShareImagingExtras } from "@/lib/share-dental";
import { ShareViewer } from "@/components/share/ShareViewer";
import type { Bundle } from "@/lib/share-types";
import { contribState } from "@/lib/share-contrib";
import type { ShareDental, ShareExtras, ShareMyNote, ShareRecall, SharePerio } from "@/lib/share-types";
import { i18n } from "@/lib/i18n";
import type { ClinicalContextData } from "@/lib/clinical-context";
import { getProcedureCatalog } from "@/lib/data";
import { activeDrugNames, type Rx } from "@/lib/prescription";
import type { ConsentRow } from "@/lib/consent";
import { evaluateSafety } from "@/lib/safety-rules";
import { getSafetyRulesForShare, shareSafetyFacts } from "@/lib/safety-server";
import { OPEN_ITEM, OPEN_PLAN } from "@/lib/treatment";

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
  const { lang } = i18n();
  const [st, { data: dental }, { data: context }, catalog, { data: extras }, { data: myNotes }, { data: recalls }, { data: examExtras }, { data: imgExtras }, { data: perioData }, { data: tpls }, { data: rxData }, safetyRules] = await Promise.all([
    contribState(session), admin.rpc("share_dental", { p_session_token: session }),
    admin.rpc("share_context", { p_session_token: session }), getProcedureCatalog(),
    admin.rpc("share_visit_note_extras", { p_session_token: session }), admin.rpc("share_my_notes", { p_session_token: session }),
    admin.rpc("share_recalls", { p_session_token: session }),
    admin.rpc("share_dental_exam_extras", { p_session_token: session }),
    admin.rpc("share_dental_imaging_extras", { p_session_token: session }),
    admin.rpc("share_perio", { p_session_token: session }),
    // the shared (non-personal) note templates, in the viewer's language
    admin.from("note_templates").select("id, title, body").is("owner_id", null).eq("is_active", true).eq("lang", lang).order("sort"),
    admin.rpc("share_rx_extras", { p_session_token: session }),
    getSafetyRulesForShare(),
  ]);
  const ex = extras as (ShareExtras & { status: string }) | null;
  const dent = dental as ShareDental | null;
  // the sections, baseline flag and pulp tests of each exam in scope, the images in more detail (the reading, the files the link
  // can open, the annotations) and the image each finding was read on
  mergeShareDental(dent, examExtras as ShareExamExtras, imgExtras as ShareImagingExtras);
  const perio = perioData as SharePerio | null;
  const ctx = context as (ClinicalContextData & { status: string; specialties: string[] | null }) | null;
  const rxx = rxData as { status: string; prescriptions?: Rx[]; consents?: ConsentRow[] } | null;
  const rx = rxx?.status === "ok" ? { prescriptions: rxx.prescriptions ?? [], consents: rxx.consents ?? [] } : null;
  // safety alerts: the reviewable rules against the shared context, the plan's treatments still to happen and the drugs prescribed
  const catalogCategory = new Map(catalog.map((c) => [c.code, c.category]));
  const facts = shareSafetyFacts(b as Bundle);
  const safety = ctx?.status === "ok"
    ? evaluateSafety(safetyRules, {
        context: ctx, labs: facts.labs, history: facts.history, drugs: activeDrugNames(rx?.prescriptions ?? []), specialties: ctx.specialties ?? "all",
        items: (dent?.status === "ok" ? dent.plans ?? [] : []).filter((pl) => OPEN_PLAN.has(pl.status)).flatMap((pl) => pl.items.filter((i) => OPEN_ITEM.has(i.status))
          .map((i) => ({ id: i.id, name: i.name, catalog_code: i.catalog_code, category: catalogCategory.get(i.catalog_code ?? "") ?? null, teeth: i.teeth, plan: pl.title }))),
      })
    : [];
  return <ShareViewer b={b as Bundle} token={params.token} contrib={st.status === "ok" ? st : null} dental={dent?.status === "ok" ? dent : null} ctx={ctx?.status === "ok" ? ctx : null}
    uploaded={searchParams.uploaded === "1"} uploadError={searchParams.upload_error} catalog={catalog}
    perio={perio?.status === "ok" ? perio : null} extras={ex?.status === "ok" ? ex : null} myNotes={(myNotes ?? []) as ShareMyNote[]} recalls={(recalls ?? []) as ShareRecall[]}
    templates={((tpls ?? []) as { id: string; title: string; body: string }[])} rx={rx} safety={safety} />;
}
