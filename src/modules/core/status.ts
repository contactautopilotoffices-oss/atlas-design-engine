import "server-only";
/**
 * Single source of truth for what is live versus planned. The UI renders these badges, so a
 * feature can only show "Live" when its dependencies are genuinely configured.
 */
import { visionStatus } from "@/modules/analysis/vision";
import { planReaderStatus } from "@/modules/floorplans/claude";
import { emailStatus } from "@/modules/handoff/email";
import { higgsfieldStatus } from "@/modules/higgsfield/config";
import { openaiStatus } from "@/modules/openai/config";
import { backend } from "@/modules/persistence";
import { staffAuthConfigured } from "@/modules/security/auth";
import { isProduction, supabaseConfigured } from "./env";

export type FeatureState = "live" | "built-awaiting-config" | "built-unverified" | "planned";
export type Feature = { key: string; label: string; stage: "green" | "orange"; state: FeatureState; detail: string };

export function systemStatus() {
  const b = backend();
  const hf = higgsfieldStatus();
  const oa = openaiStatus();
  const mail = emailStatus();
  const vision = visionStatus();
  const planReader = planReaderStatus();
  const persistenceDetail =
    b.repo.kind === "local-json"
      ? `Saved in ${b.dataDir}/store.json on this computer.`
      : b.repo.kind === "supabase"
        ? "Saved in Supabase (cloud)."
        : "Running on Vercel without Supabase: data is in temporary storage and WILL be lost.";
  const features: Feature[] = [
    { key: "ingestion", label: "Upload PDFs, presentations and images", stage: "green", state: "live", detail: "PDF, PPTX, JPG, PNG and WEBP. Legacy .ppt must be saved as .pptx first." },
    { key: "extraction", label: "Extract images and text with source page", stage: "green", state: "live", detail: "Embedded raster images and page/slide text." },
    { key: "records", label: "Source-linked JSON reference records", stage: "green", state: "live", detail: "Versioned schema (v1), REF-00001 style IDs." },
    {
      key: "analysis",
      label: "Automated image analysis",
      stage: "orange",
      state: vision.configured ? "live" : "planned",
      detail: vision.configured ? `Provider: ${vision.provider}` : vision.reason,
    },
    { key: "review", label: "Human review of room types, materials, colours and offering", stage: "green", state: "live", detail: "Colours are sampled from pixels; everything else is entered and approved by your team." },
    { key: "gallery", label: "Searchable room gallery with offering eligibility", stage: "green", state: "live", detail: "Text and attribute filters. Semantic (vector) search is not active." },
    {
      key: "plan-import",
      label: "Floor-plan upload with automatic room finding",
      stage: "green",
      state: "live",
      detail: planReader.configured
        ? `DXF: read directly. PDF and images: rooms read by Claude (${planReader.model}), checked by your team before publishing.`
        : `DXF: read directly. ${planReader.reason}`,
    },
    { key: "client-flow", label: "Floor plan, room selection and Submit Choice", stage: "green", state: "live", detail: "Selection is temporary until Submit Choice." },
    { key: "persistence", label: "Saved selections with revisions", stage: "green", state: b.repo.durable ? "live" : "built-awaiting-config", detail: persistenceDetail },
    {
      key: "supabase",
      label: "Supabase cloud storage",
      stage: "orange",
      state: supabaseConfigured() ? "built-unverified" : "built-awaiting-config",
      detail: supabaseConfigured() ? "Credentials present. Run the migrations, then verify in Studio > Status." : "SQL migrations and adapter are ready. Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    },
    { key: "measured-scene", label: "Measured scene and validation", stage: "orange", state: "live", detail: "Dimensioned 3D room from your measurements. Furniture is placeholder geometry." },
    {
      key: "higgsfield",
      label: "Higgsfield AI visualisation",
      stage: "orange",
      state: hf.configured ? "built-unverified" : "built-awaiting-config",
      detail: hf.configured
        ? `Credential found (${hf.credentialVariable}). Built from the official docs and tested against a mocked API; a live paid run has not been made yet.`
        : hf.problem ?? "Not configured.",
    },
    {
      key: "openai",
      label: "OpenAI AI visualisation",
      stage: "orange",
      state: oa.configured ? "built-unverified" : "built-awaiting-config",
      detail: oa.configured
        ? `Credential found (${oa.credentialVariable}). Supports GPT Image 2.6, 1.5 and 1 Mini with reference images.`
        : oa.problem ?? "Not configured.",
    },
    { key: "designer-review", label: "Designer review and approval", stage: "orange", state: "live", detail: "Approve, reject, comment or request another iteration." },
    { key: "handoff", label: "Approved inspiration handoff", stage: "orange", state: "live", detail: "Printable summary. AI images are never auto-approved." },
    { key: "email", label: "Email final selection summary", stage: "orange", state: mail.configured ? "built-unverified" : "built-awaiting-config", detail: mail.configured ? "Resend configured; not yet verified with a real send." : mail.reason! },
  ];
  return {
    persistence: { kind: b.repo.kind, durable: b.repo.durable, detail: persistenceDetail },
    staffAuth: { configured: staffAuthConfigured(), openDevAccess: !staffAuthConfigured() && !isProduction() },
    higgsfield: hf,
    openai: oa,
    email: mail,
    vision,
    features,
  };
}
