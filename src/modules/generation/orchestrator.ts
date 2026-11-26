import "server-only";
/**
 * Generation orchestration across Higgsfield (asynchronous polling) and OpenAI (synchronous):
 *   preview brief -> client confirms -> validate -> prepare references -> submit/execute
 *   -> store result in private generated-images storage -> unreviewed GeneratedAsset.
 * Submitting a room selection NEVER triggers generation; only an explicit, confirmed request does.
 */
import { z } from "zod";
import { audit } from "@/modules/core/audit";
import { ReferenceRole, RoomSpec, type DesignBrief, type FloorPlan, type FloorPlanPreview, type FloorPlanRoom, type GeneratedAsset, type GenerationJob, type Offering } from "@/modules/core/schemas";
import { AppError, newId, notFound, now, randomToken } from "@/modules/core/util";
import { ALL_MODELS, buildRequestBody, getAnyModel, modelProvider, resolveOpenAISize, type ImageProvider, type ModelCapability } from "@/modules/generation/models";
import { higgsfieldClient, higgsfieldStatus } from "@/modules/higgsfield/config";
import { HiggsfieldError, mapStatus } from "@/modules/higgsfield/client";
import { openaiClient, openaiStatus } from "@/modules/openai/config";
import { OpenAIError } from "@/modules/openai/client";
import { loadLibraryContext } from "@/modules/intelligence/library";

type LibraryContext = Awaited<ReturnType<typeof loadLibraryContext>>;
import { checkEligibility, allMaterials } from "@/modules/offerings/eligibility";
import { blobs, repo } from "@/modules/persistence";
import { buildPrompt, type TierPromptContext } from "@/modules/prompt/builder";
import { actorLabel, type Actor } from "@/modules/security/auth";
import { rateLimit } from "@/modules/security/rate-limit";
import { getAuthorisedSession } from "@/modules/selections/service";
import { toMetres } from "@/modules/spatial/validate";
import { materializePlanPreviewToSession } from "./preview-cache";

export const BriefRequest = z.object({
  roles: z.array(z.object({ referenceId: z.string(), role: ReferenceRole })).max(16).default([]),
  designObjective: z.string().max(500).default(""),
  overrides: z
    .object({
      materials: z.array(z.string()).optional(),
      colours: z.object({ primary: z.string().nullable(), secondary: z.string().nullable(), tertiary: z.string().nullable() }).optional(),
    })
    .default({}),
  refinementOfAssetId: z.string().nullable().default(null),
  tierOfferingId: z.string().nullable().default(null),
});
export type BriefRequest = z.infer<typeof BriefRequest>;

export const GenerateRequest = BriefRequest.extend({
  modelId: z.string(),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
  alternatives: z.number().int().min(1).max(4).default(1),
  extra: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  confirmed: z.literal(true, { message: "Generation must be explicitly confirmed because it may incur API charges." }),
});

export function providerStatuses() {
  return { higgsfield: higgsfieldStatus(), openai: openaiStatus() };
}

export function resolveEffectiveModel(requestedModelId?: string | null, defaultModelId?: string | null): ModelCapability {
  if (requestedModelId) {
    const explicit = getAnyModel(requestedModelId);
    if (explicit) return explicit;
  }
  const preferred = (defaultModelId ? getAnyModel(defaultModelId) : null) ?? ALL_MODELS[0];
  const statuses = providerStatuses();
  if (statuses[modelProvider(preferred)].configured) return preferred;
  const configuredFallback = ALL_MODELS.find((m) => statuses[modelProvider(m)].configured);
  return configuredFallback ?? preferred;
}

const describeOpening = (o: { wall: string; offset: number; width: number; height: number; sillHeight: number }, unit: string) =>
  `${o.wall} wall, ${o.width} ${unit} wide x ${o.height} ${unit} high, ${o.offset} ${unit} from the corner${o.sillHeight ? `, sill ${o.sillHeight} ${unit}` : ""}`;

async function assemble(sessionId: string, roomId: string, req: BriefRequest) {
  const { session, actor } = await getAuthorisedSession(sessionId);
  const ctx = await loadLibraryContext();
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const room = plan?.rooms.find((r) => r.id === roomId);
  if (!room) throw notFound("Room");
  const offering = ctx.offerings.find((o) => o.id === session.offeringId);
  const tierOffering = req.tierOfferingId ? ctx.offerings.find((o) => o.id === req.tierOfferingId) : null;
  if (req.tierOfferingId && !tierOffering) throw notFound("Tier offering");
  const targetOffering = tierOffering ?? offering;
  const selection = (await repo().list("selections", { sessionId })).find((s) => s.roomId === roomId);
  const specRec = (await repo().list("roomSpecs", { sessionId })).find((s) => s.roomId === roomId);
  const blockers: string[] = [];
  if (specRec && !specRec.isValid) blockers.push("The saved room measurements have errors. Fix them in Measure room, or clear them.");

  const eligible = ctx.refs.filter(
    (r) => r.metadata.roomTypeId === room.roomTypeId && (!targetOffering || checkEligibility(r, targetOffering, ctx.offerings).eligible),
  );
  const approvedFallback = ctx.refs.filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved");
  const pool = eligible.length ? eligible : tierOffering ? approvedFallback : eligible;
  const usedFallbackForTier = Boolean(tierOffering && !eligible.length && approvedFallback.length);

  const roles: Array<{ referenceId: string; role: z.infer<typeof ReferenceRole> }> = [];
  if (selection && !tierOffering) roles.push({ referenceId: selection.referenceId, role: "primary" });
  for (const r of req.roles) if (!roles.some((x) => x.referenceId === r.referenceId)) roles.push(roles.length === 0 ? { ...r, role: "primary" } : r);
  if (roles.length === 0) pool.slice(0, 3).forEach((r, i) => roles.push({ referenceId: r.id, role: i === 0 ? "primary" : "secondary" }));
  if (roles.length === 0 && !req.refinementOfAssetId) blockers.push("There are no approved pictures for this room type yet, so there is nothing to base new designs on. Approve some in Studio > Reference review.");
  const refs = roles.map((r) => {
    const ref = ctx.refs.find((x) => x.id === r.referenceId);
    if (!ref) throw notFound(`Reference ${r.referenceId}`);
    if (!usedFallbackForTier && targetOffering && !checkEligibility(ref, targetOffering, ctx.offerings).eligible) {
      throw new AppError(`${ref.referenceCode} is not available under the selected offering.`, 409);
    }
    return { ref, role: r.role, projectName: ctx.projects.find((p) => p.id === ref.projectId)?.name ?? "" };
  });

  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const spec: RoomSpec | null =
    specRec?.spec ??
    RoomSpec.parse({
      unit: plan!.unit,
      length: room.dimensions?.length ?? Math.max(...xs) - Math.min(...xs),
      width: room.dimensions?.width ?? Math.max(...ys) - Math.min(...ys),
      height: room.dimensions?.height ?? 3,
      roomTypeId: room.roomTypeId,
      occupancy: 0,
    });
  const m = spec ? toMetres(spec) : null;
  const pick = (role: string) => refs.find((r) => r.role === role)?.ref ?? refs.find((r) => r.role === "primary")?.ref;
  const colourRef = pick("colour");
  const lightRef = pick("lighting");
  const matRefs = refs.filter((r) => r.role === "material" || r.role === "primary").map((r) => r.ref);
  const roomType = ctx.roomTypes.find((t) => t.id === (spec?.roomTypeId ?? room.roomTypeId));
  const roomTypeName = roomType?.name ?? "room";
  const direction = ctx.directions.find((d) => d.id === refs[0]?.ref.metadata.designDirectionId);
  const boqItems = targetOffering ? await repo().list("boqItems") : [];
  const tierMaterials = targetOffering
    ? boqItems
        .filter((b) => b.offeringId === targetOffering.id && (b.roomTypeIds.length === 0 || b.roomTypeIds.includes(room.roomTypeId)))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 5)
        .map((b) => `${b.name}: ${b.specification || b.name}`)
    : [];
  const tierInfo: TierPromptContext | null = targetOffering
    ? {
        name: targetOffering.name,
        description: targetOffering.description,
        tierGuidance: targetOffering.tierGuidance,
        materials: tierMaterials,
      }
    : null;

  const brief: DesignBrief = {
    roomTypeName,
    intendedUse: spec?.intendedUse ?? "",
    occupancy: spec?.occupancy ?? 0,
    designObjective: req.designObjective,
    designDirection: direction?.name ?? refs[0]?.ref.metadata.designLanguage ?? null,
    dimensions: spec ? { length: spec.length, width: spec.width, height: spec.height, unit: spec.unit } : { length: 0, width: 0, height: 0, unit: "m" },
    doors: spec ? spec.doors.map((o) => describeOpening(o, spec.unit)) : [],
    windows: spec ? spec.windows.map((o) => describeOpening(o, spec.unit)) : [],
    fixedConstraints: m ? [...m.columns.map((c) => `column ${c.label || ""} ${c.w.toFixed(2)} x ${c.d.toFixed(2)} m`), ...m.obstructions.map((c) => `${c.label || "obstruction"} ${c.w.toFixed(2)} x ${c.d.toFixed(2)} m`)] : [],
    colours: req.overrides.colours ?? {
      primary: colourRef?.metadata.colors.primary ?? null,
      secondary: colourRef?.metadata.colors.secondary ?? null,
      tertiary: colourRef?.metadata.colors.tertiary ?? null,
    },
    materials: req.overrides.materials ?? Array.from(new Set(matRefs.flatMap((r) => allMaterials(r)))),
    lighting: lightRef ? ([lightRef.metadata.lighting.natural, lightRef.metadata.lighting.artificial, lightRef.metadata.lighting.ambient, lightRef.metadata.lighting.accent, lightRef.metadata.lighting.temperatureK ? `${lightRef.metadata.lighting.temperatureK} K` : null].filter(Boolean) as string[]) : [],
    furniture: spec ? spec.furniture.map((f) => `${f.count} x ${f.type} (${f.w} x ${f.d} ${spec.unit})`) : [],
    references: refs.map((r) => ({ referenceId: r.ref.id, referenceCode: r.ref.referenceCode, projectName: r.projectName, role: r.role })),
  };

  let refinement: GeneratedAsset | null = null;
  if (req.refinementOfAssetId) {
    refinement = await repo().get("generatedAssets", req.refinementOfAssetId);
    if (!refinement || refinement.sessionId !== sessionId) throw notFound("Generated image to refine");
  }
  return { session, actor, plan: plan!, room, brief, refs, refinement, blockers, tierOfferingId: tierOffering?.id ?? null, tierInfo };
}

export async function previewBrief(sessionId: string, roomId: string, raw: unknown, modelId?: string) {
  const req = BriefRequest.parse(raw);
  const a = await assemble(sessionId, roomId, req);
  const settings = await repo().get("settings", "app");
  const model = resolveEffectiveModel(modelId, settings?.defaultModelId);
  const imageCount = (a.refinement ? 1 : 0) + a.refs.length;
  const sent = model.referenceField ? Math.min(imageCount, model.maxReferences) : 0;
  const built = buildPrompt(refineBrief(a.brief, a.refinement), { instructions: settings?.promptInstructions ?? [], negativePrompt: settings?.negativePrompt ?? "", imageInputs: sent, tier: a.tierInfo });
  const warnings: string[] = [];
  if (!model.referenceField && imageCount) warnings.push("The chosen model does not accept reference images. Your references will only be described in text.");
  if (model.referenceField && imageCount > model.maxReferences) warnings.push(`This model accepts at most ${model.maxReferences} reference images; only the first ${model.maxReferences} will be sent.`);
  if (model.minReferences > imageCount) warnings.push(`This model needs at least ${model.minReferences} reference image(s).`);
  const providers = providerStatuses();
  return { brief: a.brief, prompt: built, model, models: ALL_MODELS, imagesSent: sent, warnings, blockers: a.blockers, provider: providers[modelProvider(model)], providers };
}

function refineBrief(brief: DesignBrief, refinement: GeneratedAsset | null): DesignBrief {
  if (!refinement) return brief;
  return { ...brief, designObjective: `${brief.designObjective} Refine the first supplied image (a previous concept) while keeping its layout.`.trim() };
}

async function storeGeneratedImage(job: Pick<GenerationJob, "id" | "sessionId" | "roomId" | "tierOfferingId">, index: number, data: Buffer, contentType: string, providerUrl: string | null) {
  const ct = contentType.split(";")[0].trim() || "image/png";
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const asset: GeneratedAsset = {
    id: newId("gen"),
    jobId: job.id,
    sessionId: job.sessionId,
    roomId: job.roomId,
    tierOfferingId: job.tierOfferingId ?? null,
    blobKey: `${job.sessionId}/${job.id}-${index}.${ext}`,
    providerUrl,
    mimeType: ct,
    reviewStatus: "unreviewed",
    isHandoffAsset: false,
    createdAt: now(),
    updatedAt: now(),
  };
  await blobs().put("generated-images", asset.blobKey, data, ct);
  await repo().insert("generatedAssets", asset);
  return asset.id;
}

async function loadInputBlobs(usable: GenerationJob["referenceInputs"], refs: Array<{ ref: { id: string; blobKey: string } }>, refinement: GeneratedAsset | null) {
  const loaded: Array<{ input: GenerationJob["referenceInputs"][number]; data: Buffer; contentType: string; filename: string }> = [];
  for (const [i, input] of usable.entries()) {
    const key = input.kind === "generated" ? refinement!.blobKey : refs.find((r) => r.ref.id === input.referenceId)!.ref.blobKey;
    const blob = await blobs().get(input.kind === "generated" ? "generated-images" : "reference-images", key);
    if (!blob) throw new AppError(`Image for ${input.referenceId} is missing from storage.`, 500);
    const ext = blob.contentType.includes("jpeg") ? "jpg" : blob.contentType.includes("webp") ? "webp" : "png";
    loaded.push({ input, data: blob.data, contentType: blob.contentType, filename: `ref-${i + 1}.${ext}` });
  }
  return loaded;
}

const sessionControllers = new Map<string, Set<AbortController>>();

function trackSessionSignal(sessionId: string, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const onExtAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExtAbort, { once: true });
  }
  let set = sessionControllers.get(sessionId);
  if (!set) {
    set = new Set();
    sessionControllers.set(sessionId, set);
  }
  set.add(controller);
  const cleanup = () => {
    set?.delete(controller);
    if (set && set.size === 0) sessionControllers.delete(sessionId);
    externalSignal?.removeEventListener("abort", onExtAbort);
  };
  return { signal: controller.signal, controller, cleanup };
}

/** Immediately aborts any in-flight AI image requests and cancels pending jobs for a client session. */
export async function cancelSessionGeneration(sessionId: string, actor: Actor) {
  const active = sessionControllers.get(sessionId);
  const abortedRequests = active?.size ?? 0;
  if (active) {
    for (const c of active) c.abort();
  }
  const jobs = await repo().list("generationJobs", { sessionId });
  const hf = higgsfieldClient();
  let cancelledJobs = 0;
  for (const job of jobs) {
    if (TERMINAL.has(job.status)) continue;
    if (job.providerRequestId && hf) {
      await hf.cancel(job.providerRequestId).catch(() => false);
    }
    await repo().update("generationJobs", job.id, {
      status: "cancelled",
      error: "Stopped by user.",
      completedAt: now(),
      updatedAt: now(),
    });
    cancelledJobs++;
  }
  await audit("generation.stop", actorLabel(actor), "designSession", sessionId, { abortedRequests, cancelledJobs });
  return { sessionId, stopped: true, abortedRequests, cancelledJobs };
}

export async function createGeneration(
  sessionId: string,
  roomId: string,
  raw: unknown,
  opts: { bypassRateLimit?: boolean; signal?: AbortSignal } = {},
) {
  const req = GenerateRequest.parse(raw);
  const { signal, cleanup } = trackSessionSignal(sessionId, opts.signal);
  try {
    return await createGenerationWithSignal(sessionId, roomId, req, signal, Boolean(opts.bypassRateLimit));
  } finally {
    cleanup();
  }
}

async function createGenerationWithSignal(
  sessionId: string,
  roomId: string,
  req: z.infer<typeof GenerateRequest>,
  signal: AbortSignal,
  bypassRateLimit: boolean,
) {
  const a = await assemble(sessionId, roomId, req);
  if (a.blockers.length) throw new AppError(a.blockers.join(" "), 409, "not_ready");
  const model = getAnyModel(req.modelId);
  if (!model) throw new AppError("Unknown or undocumented model.", 400);
  const provider: ImageProvider = modelProvider(model);

  const hfClient = provider === "higgsfield" ? higgsfieldClient() : null;
  const oaClient = provider === "openai" ? openaiClient() : null;
  if (provider === "higgsfield" && !hfClient) {
    throw new AppError(higgsfieldStatus().problem ?? "Higgsfield is not configured.", 503, "provider_not_configured");
  }
  if (provider === "openai" && !oaClient) {
    throw new AppError(openaiStatus().problem ?? "OpenAI is not configured.", 503, "provider_not_configured");
  }

  if (!bypassRateLimit) {
    rateLimit(`gen:${sessionId}`, 6, 10 * 60_000);
    rateLimit("gen:global", 30, 10 * 60_000);
  }

  const imageInputs: GenerationJob["referenceInputs"] = [];
  if (a.refinement) imageInputs.push({ referenceId: a.refinement.id, role: "primary", kind: "generated", providerUrl: null });
  for (const r of a.refs) imageInputs.push({ referenceId: r.ref.id, role: r.role, kind: "reference", providerUrl: null });
  const usable = model.referenceField ? imageInputs.slice(0, model.maxReferences) : [];
  if (usable.length < model.minReferences) throw new AppError(`${model.label} needs at least ${model.minReferences} reference image(s).`);

  const settings = await repo().get("settings", "app");
  const built = buildPrompt(refineBrief(a.brief, a.refinement), { instructions: settings?.promptInstructions ?? [], negativePrompt: settings?.negativePrompt ?? "", imageInputs: usable.length, tier: a.tierInfo });
  const loadedBlobs = await loadInputBlobs(usable, a.refs, a.refinement);

  if (provider === "higgsfield" && hfClient) {
    // Upload the actual reference images once per batch (not just their names).
    for (const item of loadedBlobs) {
      if (signal.aborted) throw new AppError("Generation cancelled.", 499, "cancelled");
      try {
        item.input.providerUrl = await hfClient.uploadImage(item.data, item.contentType);
      } catch (e) {
        throw new AppError(e instanceof HiggsfieldError ? e.message : "Reference upload to Higgsfield failed.", 502, "provider_error");
      }
    }
  }

  const batchId = newId("batch");
  const requests = model.imagesPerRequest.field ? 1 : req.alternatives;
  const jobs: GenerationJob[] = [];

  for (let i = 0; i < requests; i++) {
    if (signal.aborted) break;
    const t = now();
    const job: GenerationJob = {
      id: newId("job"),
      batchId,
      sessionId,
      roomId,
      status: "draft",
      modelId: model.id,
      settings: {
        resolution: req.resolution ?? model.defaultResolution,
        aspectRatio: req.aspectRatio ?? model.defaultAspectRatio,
        alternatives: req.alternatives,
        alternativeIndex: i + 1,
        ...req.extra,
      },
      brief: a.brief,
      prompt: requests > 1 ? `${built.prompt}\n\nThis is option ${i + 1} of ${requests}: give it its own distinct take on the brief.` : built.prompt,
      negativePrompt: model.supportsNegativePrompt ? built.negativePrompt : "",
      referenceInputs: usable,
      refinementOfAssetId: a.refinement?.id ?? null,
      tierOfferingId: a.tierOfferingId,
      idempotencyKey: `atlas-${randomToken(16)}`,
      providerRequestId: null,
      providerStatusUrl: null,
      providerCancelUrl: null,
      providerRawStatus: null,
      attempts: 0,
      nextPollAt: null,
      error: null,
      costNote:
        provider === "openai"
          ? "See the OpenAI Platform dashboard for billing."
          : "Not reported by the Higgsfield API response; see the Higgsfield console for billing.",
      outputAssetIds: [],
      createdBy: actorLabel(a.actor as Actor),
      createdAt: t,
      updatedAt: t,
      submittedAt: null,
      completedAt: null,
    };
    await repo().insert("generationJobs", job);

    if (provider === "openai" && oaClient) {
      const qualityVal = typeof req.extra.quality === "string" && ["low", "medium", "high"].includes(req.extra.quality)
        ? req.extra.quality
        : String(model.extra.quality?.default ?? "medium");
      const size = resolveOpenAISize(model, String(job.settings.resolution), String(job.settings.aspectRatio));
      try {
        await repo().update("generationJobs", job.id, { status: "processing", submittedAt: now(), updatedAt: now() });
        const oaiReq = {
          model: model.endpoint,
          prompt: job.prompt,
          n: Math.min(model.imagesPerRequest.max, Math.max(1, req.alternatives)),
          size,
          quality: qualityVal,
          outputFormat: "png" as const,
          signal,
        };
        const res = loadedBlobs.length
          ? await oaClient.edit({ ...oaiReq, images: loadedBlobs.map((b) => ({ data: b.data, contentType: b.contentType, filename: b.filename })) })
          : await oaClient.generate(oaiReq);

        if (signal.aborted) {
          jobs.push(await repo().update("generationJobs", job.id, { status: "cancelled", error: "Stopped by user.", completedAt: now(), updatedAt: now() }));
          break;
        }

        const assetIds: string[] = [];
        for (const [idx, item] of (res.data ?? []).entries()) {
          if (item.b64_json) {
            assetIds.push(await storeGeneratedImage(job, idx, Buffer.from(item.b64_json, "base64"), "image/png", null));
          } else if (item.url) {
            const dl = await download(item.url);
            if (!dl.ok) continue;
            const ct = dl.headers.get("content-type")?.split(";")[0] ?? "image/png";
            assetIds.push(await storeGeneratedImage(job, idx, Buffer.from(await dl.arrayBuffer()), ct, item.url));
          }
        }
        const usageNote = res.usage?.total_tokens
          ? `OpenAI usage: ${res.usage.total_tokens} tokens (${res.usage.input_tokens ?? 0} in, ${res.usage.output_tokens ?? 0} out). See OpenAI billing.`
          : job.costNote;
        const completed = await repo().update("generationJobs", job.id, {
          status: assetIds.length ? "completed" : "failed",
          error: assetIds.length ? null : "OpenAI returned no images.",
          providerRawStatus: assetIds.length ? "completed" : "empty",
          outputAssetIds: assetIds,
          costNote: usageNote,
          attempts: 1,
          completedAt: now(),
          updatedAt: now(),
        });
        jobs.push(completed);
      } catch (e) {
        const stopped = signal.aborted || (e instanceof OpenAIError && e.httpStatus === 499);
        const msg = stopped ? "Stopped by user." : e instanceof OpenAIError ? e.message : "OpenAI image generation failed.";
        jobs.push(await repo().update("generationJobs", job.id, { status: stopped ? "cancelled" : "failed", error: msg, completedAt: now(), updatedAt: now() }));
      }
      continue;
    }

    const body = buildRequestBody(model, {
      prompt: job.prompt,
      negativePrompt: built.negativePrompt,
      imageUrls: usable.map((u) => u.providerUrl!).filter(Boolean),
      resolution: String(job.settings.resolution),
      aspectRatio: String(job.settings.aspectRatio),
      count: req.alternatives,
      extra: req.extra,
    });
    try {
      const res = await hfClient!.submit(model.endpoint, body, job.idempotencyKey);
      jobs.push(
        await repo().update("generationJobs", job.id, {
          status: mapStatus(res.status) === "queued" ? "submitted" : mapStatus(res.status),
          providerRequestId: res.request_id,
          providerStatusUrl: res.status_url ?? null,
          providerCancelUrl: res.cancel_url ?? null,
          providerRawStatus: res.status,
          submittedAt: now(),
          nextPollAt: new Date(Date.now() + 2000).toISOString(),
          updatedAt: now(),
        }),
      );
    } catch (e) {
      const msg = e instanceof HiggsfieldError ? e.message : "Submission to Higgsfield failed.";
      jobs.push(await repo().update("generationJobs", job.id, { status: "failed", error: msg, updatedAt: now() }));
    }
  }
  await audit("generation.submit", actorLabel(a.actor as Actor), "generationJob", batchId, { provider, model: model.id, jobs: jobs.length, references: usable.map((u) => u.referenceId) });
  return { batchId, jobs };
}

let download: typeof fetch = (input, init) => fetch(input, init);
/** Tests inject a fake downloader so no network is used. */
export const __setDownloader = (f: typeof fetch | null) => {
  download = f ?? ((input, init) => fetch(input, init));
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

async function authorisedJob(jobId: string) {
  const job = await repo().get("generationJobs", jobId);
  if (!job) throw notFound("Generation job");
  const auth = await getAuthorisedSession(job.sessionId);
  return { job, actor: auth.actor };
}

/** Polls the provider at most once per backoff window; safe to call repeatedly from the browser. */
export async function refreshJob(jobId: string) {
  const { job } = await authorisedJob(jobId);
  if (TERMINAL.has(job.status) || !job.providerRequestId) return job;
  const model = getAnyModel(job.modelId);
  if (model && modelProvider(model) !== "higgsfield") return job;
  if (job.nextPollAt && Date.parse(job.nextPollAt) > Date.now()) return job;
  const client = higgsfieldClient();
  if (!client) return job;
  const attempts = job.attempts + 1;
  const delay = Math.min(10_000, 2000 * 1.5 ** attempts) + Math.random() * 500;
  let res;
  try {
    res = await client.status(job.providerRequestId);
  } catch (e) {
    const fatal = e instanceof HiggsfieldError && (e.httpStatus === 401 || e.httpStatus === 404);
    return repo().update("generationJobs", job.id, {
      attempts,
      nextPollAt: new Date(Date.now() + delay).toISOString(),
      status: fatal ? "failed" : job.status,
      error: e instanceof Error ? e.message : "Status check failed.",
      updatedAt: now(),
    });
  }
  const mapped = mapStatus(res.status);
  if (mapped !== "completed") {
    return repo().update("generationJobs", job.id, {
      status: mapped,
      providerRawStatus: res.status,
      attempts,
      nextPollAt: new Date(Date.now() + delay).toISOString(),
      error: mapped === "failed" ? (res.status === "nsfw" ? "Rejected by the provider's content moderation." : res.error ?? "Generation failed.") : null,
      completedAt: TERMINAL.has(mapped) ? now() : null,
      updatedAt: now(),
    });
  }
  const assetIds: string[] = [];
  for (const [i, img] of (res.images ?? []).entries()) {
    const dl = await download(img.url);
    if (!dl.ok) continue;
    const ct = dl.headers.get("content-type")?.split(";")[0] ?? "image/png";
    assetIds.push(await storeGeneratedImage(job, i, Buffer.from(await dl.arrayBuffer()), ct, img.url));
  }
  const updated = await repo().update("generationJobs", job.id, {
    status: assetIds.length ? "completed" : "failed",
    error: assetIds.length ? null : "Provider reported completion but the output could not be downloaded.",
    providerRawStatus: res.status,
    outputAssetIds: assetIds,
    attempts,
    completedAt: now(),
    updatedAt: now(),
  });
  await audit("generation.completed", "system", "generationJob", job.id, { outputs: assetIds.length });
  return updated;
}

export async function cancelJob(jobId: string) {
  const { job } = await authorisedJob(jobId);
  if (TERMINAL.has(job.status)) return { job, cancelled: false, message: "This job has already finished." };
  if (!job.providerRequestId) return { job: await repo().update("generationJobs", job.id, { status: "cancelled", updatedAt: now() }), cancelled: true, message: "Cancelled before submission." };
  const model = getAnyModel(job.modelId);
  if (model && modelProvider(model) !== "higgsfield") return { job, cancelled: false, message: "Synchronous jobs cannot be cancelled mid-flight." };
  const client = higgsfieldClient();
  if (!client) throw new AppError("Higgsfield is not configured.", 503);
  const ok = await client.cancel(job.providerRequestId);
  if (!ok) return { job, cancelled: false, message: "Higgsfield has already started this image, so it can no longer be cancelled." };
  const updated = await repo().update("generationJobs", job.id, { status: "cancelled", completedAt: now(), updatedAt: now() });
  await audit("generation.cancel", "client", "generationJob", job.id);
  return { job: updated, cancelled: true, message: "Cancelled." };
}

export async function listJobs(filter: { sessionId?: string; roomId?: string } = {}) {
  const jobs = await repo().list("generationJobs", filter.sessionId ? { sessionId: filter.sessionId } : undefined);
  return jobs.filter((j) => !filter.roomId || j.roomId === filter.roomId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function unlinkAndRemoveGeneratedAsset(asset: GeneratedAsset) {
  const r = repo();
  const [selections, revisions, reviews, job] = await Promise.all([
    r.list("selections", { sessionId: asset.sessionId }),
    r.list("selectionRevisions", { sessionId: asset.sessionId }),
    r.list("designerReviews", { sessionId: asset.sessionId }),
    r.get("generationJobs", asset.jobId),
  ]);
  for (const s of selections) if (s.generatedAssetId === asset.id) await r.update("selections", s.id, { generatedAssetId: null });
  for (const rev of revisions) if (rev.generatedAssetId === asset.id) await r.update("selectionRevisions", rev.id, { generatedAssetId: null });
  for (const rv of reviews) if (rv.generatedAssetId === asset.id) await r.update("designerReviews", rv.id, { generatedAssetId: null });
  if (job && job.outputAssetIds.includes(asset.id)) {
    await r.update("generationJobs", job.id, { outputAssetIds: job.outputAssetIds.filter((x) => x !== asset.id), updatedAt: now() });
  }
  await blobs().remove("generated-images", asset.blobKey).catch(() => undefined);
  await r.remove("generatedAssets", asset.id);
}

/** Deletes a generated AI image (keeping any selection's library reference intact). */
export async function deleteGeneratedAsset(assetId: string) {
  const asset = await repo().get("generatedAssets", assetId);
  if (!asset) throw notFound("Generated image");
  const { actor } = await getAuthorisedSession(asset.sessionId);
  await repo().exclusive(`session:${asset.sessionId}`, () => unlinkAndRemoveGeneratedAsset(asset));
  await audit("generatedAsset.delete", actorLabel(actor), "generatedAsset", assetId, { sessionId: asset.sessionId });
}

/** Deletes a generation job and any generated images produced by it. */
export async function deleteGenerationJob(jobId: string) {
  const { job, actor } = await authorisedJob(jobId);
  await repo().exclusive(`session:${job.sessionId}`, async () => {
    const assets = (await repo().list("generatedAssets", { sessionId: job.sessionId })).filter((a) => a.jobId === job.id);
    for (const a of assets) await unlinkAndRemoveGeneratedAsset(a);
    await repo().remove("generationJobs", job.id);
  });
  await audit("generationJob.delete", actorLabel(actor), "generationJob", jobId, { sessionId: job.sessionId });
}

async function savePreviewBlobToPlan(plan: FloorPlan, roomId: string, tierOfferingId: string, referenceId: string, data: Buffer, contentType: string, modelId: string): Promise<FloorPlanPreview> {
  const ct = contentType.split(";")[0].trim() || "image/png";
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const id = newId("prev");
  const blobKey = `${plan.id}/previews/${roomId}-${tierOfferingId}-${id}.${ext}`;
  await blobs().put("floor-plans", blobKey, data, ct);
  return { id, roomId, tierOfferingId, referenceId, blobKey, mimeType: ct, modelId, createdAt: now() };
}

const inFlightAutoPreviews = new Map<string, Promise<{
  roomId: string;
  generatedCount: number;
  cachedReused: number;
  pendingJobIds: string[];
  skippedReason: string | null;
  errors: string[];
}>>();

/**
 * Ensures categorized AI previews (Economy, Premium Economy, ...) exist for one room
 * in a session. Reuses existing session assets or cached FloorPlan previews first, and generates
 * missing tiers in parallel when an AI provider is configured (e.g. triggered automatically on hover).
 */
export async function autoGenerateRoomPreviews(sessionId: string, roomId: string, opts: { modelId?: string; tierIds?: string[] } = {}) {
  const dedupKey = `${sessionId}:${roomId}`;
  const running = inFlightAutoPreviews.get(dedupKey);
  if (running) return running;

  const task = (async () => {
    const { session, actor } = await getAuthorisedSession(sessionId);

    const prep = await repo().exclusive(`autoprev-prep:${session.floorPlanId}:${roomId}`, async () => {
      const [ctx, plan, settings, existingAssets, existingJobs] = await Promise.all([
        loadLibraryContext(),
        repo().get("floorPlans", session.floorPlanId),
        repo().get("settings", "app"),
        repo().list("generatedAssets", { sessionId }),
        repo().list("generationJobs", { sessionId }),
      ]);
      if (!plan) throw notFound("Floor plan");
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) throw notFound("Room");

      const allOfferings = [...ctx.offerings].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
      const targetOfferings = opts.tierIds?.length ? allOfferings.filter((o) => opts.tierIds!.includes(o.id)) : allOfferings;
      const approvedRefs = ctx.refs.filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved");

      const cachedToHydrate = (plan.previews ?? []).filter(
        (p) =>
          p.roomId === roomId &&
          targetOfferings.some((o) => o.id === p.tierOfferingId) &&
          !existingAssets.some((a) => a.roomId === roomId && a.tierOfferingId === p.tierOfferingId && a.reviewStatus !== "rejected"),
      );
      for (const prev of cachedToHydrate) {
        const mat = await materializePlanPreviewToSession(sessionId, prev);
        if (mat) existingAssets.push(mat);
      }

      const model = resolveEffectiveModel(opts.modelId, settings?.defaultModelId);
      const statuses = providerStatuses();
      const providerConfigured = statuses[modelProvider(model)].configured;
      const missingOfferings = targetOfferings.filter(
        (o) => !existingAssets.some((a) => a.roomId === roomId && a.tierOfferingId === o.id && a.reviewStatus !== "rejected"),
      );

      const pendingJobIds: string[] = [];
      const toRun: Offering[] = [];
      let skippedReason: string | null = null;
      if (missingOfferings.length > 0) {
        if (!approvedRefs.length) {
          skippedReason = "Approve at least one past-project reference photo for this room type in Studio to auto-generate AI previews.";
        } else if (!providerConfigured) {
          skippedReason = "No AI image provider configured (OPENAI_API_KEY or Higgsfield).";
        } else {
          for (const o of missingOfferings) {
            const inflight = existingJobs.find((j) => j.roomId === roomId && j.tierOfferingId === o.id && !TERMINAL.has(j.status));
            if (inflight) pendingJobIds.push(inflight.id);
            else toRun.push(o);
          }
        }
      }
      return { plan, room, model, approvedRefs, cachedCount: cachedToHydrate.length, pendingJobIds, toRun, skippedReason };
    });

    const { plan, room, model, approvedRefs, cachedCount, pendingJobIds, toRun, skippedReason } = prep;
    const newPlanPreviews: FloorPlanPreview[] = [];
    const errors: string[] = [];
    let generatedCount = 0;

    if (toRun.length > 0) {
      const { signal, cleanup } = trackSessionSignal(sessionId);
      try {
        // Run provider calls outside the exclusive store lock so LocalJsonRepository serializes individual DB writes cleanly.
        const results = await Promise.allSettled(
          toRun.map(async (tier) => {
            if (signal.aborted) throw new AppError("Generation cancelled.", 499, "cancelled");
            const { jobs } = await createGeneration(
              sessionId,
              roomId,
              {
                modelId: model.id,
                alternatives: 1,
                roles: [],
                tierOfferingId: tier.id,
                designObjective: `Restyle this ${room.name} concept to match the ${tier.name} package finish tier while maintaining spatial coherence.`,
                confirmed: true,
              },
              { bypassRateLimit: true, signal },
            );
            return { tier, jobs };
          }),
        );

        for (const res of results) {
          if (res.status !== "fulfilled") {
            errors.push((res.reason as Error)?.message ?? String(res.reason));
            continue;
          }
          const { tier, jobs } = res.value;
          for (const job of jobs) {
            if (!TERMINAL.has(job.status)) pendingJobIds.push(job.id);
            if (job.status === "failed" && job.error) errors.push(`${tier.name}: ${job.error}`);
            if (job.outputAssetIds.length > 0) {
              generatedCount += job.outputAssetIds.length;
              const asset = await repo().get("generatedAssets", job.outputAssetIds[0]);
              if (asset && !(plan.previews ?? []).some((p) => p.roomId === roomId && p.tierOfferingId === tier.id)) {
                const blob = await blobs().get("generated-images", asset.blobKey);
                const refId = job.referenceInputs.find((r) => r.kind === "reference")?.referenceId ?? approvedRefs[0].id;
                if (blob) {
                  newPlanPreviews.push(await savePreviewBlobToPlan(plan, roomId, tier.id, refId, blob.data, blob.contentType, model.id));
                }
              }
            }
          }
        }
      } finally {
        cleanup();
      }
    }

    if (newPlanPreviews.length > 0) {
      await repo().exclusive(`plan:${plan.id}`, async () => {
        const freshPlan = (await repo().get("floorPlans", plan.id)) ?? plan;
        const merged = [
          ...(freshPlan.previews ?? []).filter((p) => !newPlanPreviews.some((n) => n.roomId === p.roomId && n.tierOfferingId === p.tierOfferingId)),
          ...newPlanPreviews,
        ];
        await repo().update("floorPlans", plan.id, { previews: merged, updatedAt: now() });
      });
    }

    await audit("generation.autoPreview", actorLabel(actor), "floorPlan", plan.id, {
      sessionId,
      roomId,
      generatedCount,
      cachedReused: cachedCount,
      pending: pendingJobIds.length,
      errors: errors.length,
    });

    return { roomId, generatedCount, cachedReused: cachedCount, pendingJobIds, skippedReason, errors };
  })().finally(() => {
    inFlightAutoPreviews.delete(dedupKey);
  });

  inFlightAutoPreviews.set(dedupKey, task);
  return task;
}

function buildDirectBrief(
  plan: FloorPlan,
  room: FloorPlanRoom,
  offering: Offering,
  ctx: LibraryContext,
  boqMaterials: string[],
) {
  const approved = ctx.refs.filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved");
  const eligible = approved.filter((r) => checkEligibility(r, offering, ctx.offerings).eligible);
  const refs = (eligible.length ? eligible : approved).slice(0, 3).map((r, i) => ({
    ref: r,
    role: (i === 0 ? "primary" : "secondary") as z.infer<typeof ReferenceRole>,
    projectName: ctx.projects.find((p) => p.id === r.projectId)?.name ?? "",
  }));
  const primary = refs[0]?.ref;
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const length = room.dimensions?.length ?? Math.max(1, Math.max(...xs) - Math.min(...xs));
  const width = room.dimensions?.width ?? Math.max(1, Math.max(...ys) - Math.min(...ys));
  const height = room.dimensions?.height ?? 3;
  const roomTypeName = ctx.roomTypes.find((t) => t.id === room.roomTypeId)?.name ?? "room";
  const direction = primary ? ctx.directions.find((d) => d.id === primary.metadata.designDirectionId) : undefined;
  const brief: DesignBrief = {
    roomTypeName,
    intendedUse: room.labelText || room.name,
    occupancy: 0,
    designObjective: `Create a ${offering.name} interior concept for ${room.name} grounded in past-project references.`,
    designDirection: direction?.name ?? primary?.metadata.designLanguage ?? null,
    dimensions: { length, width, height, unit: plan.unit },
    doors: [],
    windows: [],
    fixedConstraints: [],
    colours: primary ? primary.metadata.colors : { primary: null, secondary: null, tertiary: null },
    materials: refs.flatMap((r) => allMaterials(r.ref)),
    lighting: primary
      ? ([primary.metadata.lighting.natural, primary.metadata.lighting.artificial, primary.metadata.lighting.ambient].filter(Boolean) as string[])
      : [],
    furniture: [],
    references: refs.map((r) => ({ referenceId: r.ref.id, referenceCode: r.ref.referenceCode, projectName: r.projectName, role: r.role })),
  };
  const tierInfo: TierPromptContext = {
    name: offering.name,
    description: offering.description,
    tierGuidance: offering.tierGuidance,
    materials: boqMaterials,
  };
  return { brief, refs, tierInfo };
}

export type FloorPlanPreviewRun = {
  floorPlanId: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  total: number;
  done: number;
  generated: number;
  skippedExisting: number;
  skippedNoRefs: number;
  errors: string[];
  cancelled: boolean;
};

type InternalPlanRun = FloorPlanPreviewRun & { controller: AbortController };
const floorPlanRuns = new Map<string, InternalPlanRun>();

const publicRunView = (r: InternalPlanRun): FloorPlanPreviewRun => ({
  floorPlanId: r.floorPlanId,
  status: r.status,
  total: r.total,
  done: r.done,
  generated: r.generated,
  skippedExisting: r.skippedExisting,
  skippedNoRefs: r.skippedNoRefs,
  errors: [...r.errors],
  cancelled: r.cancelled,
});

export async function getFloorPlanPreviewStatus(floorPlanId: string) {
  const [plan, offerings] = await Promise.all([repo().get("floorPlans", floorPlanId), repo().list("offerings")]);
  if (!plan) throw notFound("Floor plan");
  const expectedTotal = plan.rooms.length * offerings.length;
  const cachedCount = plan.previews?.length ?? 0;
  const active = floorPlanRuns.get(floorPlanId);
  const run: FloorPlanPreviewRun = active
    ? publicRunView(active)
    : { floorPlanId, status: "idle", total: expectedTotal, done: cachedCount, generated: 0, skippedExisting: cachedCount, skippedNoRefs: 0, errors: [], cancelled: false };
  return { ...run, cachedCount, expectedTotal };
}

export async function cancelFloorPlanPreviewJob(floorPlanId: string, actor: Actor) {
  const active = floorPlanRuns.get(floorPlanId);
  if (active && active.status === "running") {
    active.controller.abort();
    active.cancelled = true;
    active.status = "cancelled";
    await audit("floorplan.previews.stop", actorLabel(actor), "floorPlan", floorPlanId, { done: active.done, generated: active.generated });
  }
  return getFloorPlanPreviewStatus(floorPlanId);
}

/**
 * Starts non-blocking background AI pre-generation for a FloorPlan (used on Publish or from Studio)
 * so previews are rendered before clients open their session. Can be aborted anytime via cancelFloorPlanPreviewJob.
 */
export async function startFloorPlanPreviewJob(
  floorPlanId: string,
  actor: Actor,
  opts: { roomIds?: string[]; tierOfferingIds?: string[]; modelId?: string; force?: boolean } = {},
) {
  const existing = floorPlanRuns.get(floorPlanId);
  if (existing && existing.status === "running") return getFloorPlanPreviewStatus(floorPlanId);

  const controller = new AbortController();
  const runState: InternalPlanRun = {
    floorPlanId,
    status: "running",
    total: 0,
    done: 0,
    generated: 0,
    skippedExisting: 0,
    skippedNoRefs: 0,
    errors: [],
    cancelled: false,
    controller,
  };
  floorPlanRuns.set(floorPlanId, runState);

  void generateFloorPlanPreviews(floorPlanId, actor, { ...opts, signal: controller.signal, _run: runState }).catch((e) => {
    if (runState.status === "running") {
      runState.status = controller.signal.aborted ? "cancelled" : "failed";
      if (!controller.signal.aborted) runState.errors.push((e as Error).message);
    }
  });

  // Yield a microtask so synchronous setup computes `total` before returning status.
  await Promise.resolve();
  return getFloorPlanPreviewStatus(floorPlanId);
}

/**
 * Staff/batch generator: pre-generates categorized AI previews directly on a FloorPlan so every
 * future client hover renders immediately without wait or duplicate API spend.
 */
export async function generateFloorPlanPreviews(
  floorPlanId: string,
  actor: Actor,
  opts: { roomIds?: string[]; tierOfferingIds?: string[]; modelId?: string; force?: boolean; signal?: AbortSignal; _run?: InternalPlanRun } = {},
) {
  const oaClient = openaiClient();
  if (!oaClient) {
    throw new AppError(
      openaiStatus().problem ?? "Floor-plan batch pre-generation requires OPENAI_API_KEY in .env (for synchronous multi-room previews).",
      503,
      "provider_not_configured",
    );
  }
  const [ctx, plan, settings, boqItems] = await Promise.all([
    loadLibraryContext(),
    repo().get("floorPlans", floorPlanId),
    repo().get("settings", "app"),
    repo().list("boqItems"),
  ]);
  if (!plan) throw notFound("Floor plan");
  const model = resolveEffectiveModel(opts.modelId, settings?.defaultModelId);
  if (modelProvider(model) !== "openai") {
    throw new AppError("Floor-plan batch pre-generation currently requires an OpenAI image model.", 400);
  }

  const ownedController = opts._run ? opts._run.controller : new AbortController();
  const extSignal = opts.signal;
  const onAbort = () => ownedController.abort();
  if (extSignal) {
    if (extSignal.aborted) ownedController.abort();
    else extSignal.addEventListener("abort", onAbort, { once: true });
  }
  const signal = ownedController.signal;

  const rooms = opts.roomIds?.length ? plan.rooms.filter((r) => opts.roomIds!.includes(r.id)) : plan.rooms;
  const offerings = [...ctx.offerings]
    .filter((o) => !opts.tierOfferingIds?.length || opts.tierOfferingIds.includes(o.id))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  let generated = 0;
  let skippedExisting = 0;
  let skippedNoRefs = 0;
  const errors: string[] = [];
  const nextPreviews: FloorPlanPreview[] = [...(plan.previews ?? [])];

  const tasks: Array<{ room: FloorPlanRoom; tier: Offering }> = [];
  for (const room of rooms) {
    for (const tier of offerings) {
      if (!opts.force && nextPreviews.some((p) => p.roomId === room.id && p.tierOfferingId === tier.id)) {
        skippedExisting++;
        continue;
      }
      tasks.push({ room, tier });
    }
  }

  const runState: InternalPlanRun =
    opts._run ?? {
      floorPlanId,
      status: "running",
      total: tasks.length,
      done: 0,
      generated: 0,
      skippedExisting,
      skippedNoRefs: 0,
      errors: [],
      cancelled: false,
      controller: ownedController,
    };
  runState.total = tasks.length;
  runState.skippedExisting = skippedExisting;
  if (!opts._run) floorPlanRuns.set(floorPlanId, runState);

  const flushPreview = async (prev: FloorPlanPreview) => {
    await repo().exclusive(`plan:${plan.id}`, async () => {
      const latest = (await repo().get("floorPlans", plan.id)) ?? plan;
      const cur = [...(latest.previews ?? [])];
      const old = cur.find((p) => p.roomId === prev.roomId && p.tierOfferingId === prev.tierOfferingId);
      if (old) await blobs().remove("floor-plans", old.blobKey).catch(() => undefined);
      const idx = cur.findIndex((p) => p.roomId === prev.roomId && p.tierOfferingId === prev.tierOfferingId);
      if (idx >= 0) cur[idx] = prev;
      else cur.push(prev);
      await repo().update("floorPlans", plan.id, { previews: cur, updatedAt: now() });
    });
  };

  const runOne = async ({ room, tier }: { room: FloorPlanRoom; tier: Offering }) => {
    if (signal.aborted) return;
    const tierMaterials = boqItems
      .filter((b) => b.offeringId === tier.id && (b.roomTypeIds.length === 0 || b.roomTypeIds.includes(room.roomTypeId)))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 5)
      .map((b) => `${b.name}: ${b.specification || b.name}`);
    const { brief, refs, tierInfo } = buildDirectBrief(plan, room, tier, ctx, tierMaterials);
    if (!refs.length) {
      skippedNoRefs++;
      runState.skippedNoRefs++;
      runState.done++;
      return;
    }
    const usable = model.referenceField ? refs.slice(0, model.maxReferences) : [];
    const loaded: Array<{ data: Buffer; contentType: string; filename: string }> = [];
    for (const [i, item] of usable.entries()) {
      const b = await blobs().get("reference-images", item.ref.blobKey);
      if (!b) continue;
      const ext = b.contentType.includes("jpeg") ? "jpg" : b.contentType.includes("webp") ? "webp" : "png";
      loaded.push({ data: b.data, contentType: b.contentType, filename: `ref-${i + 1}.${ext}` });
    }
    if (signal.aborted) return;
    const built = buildPrompt(brief, {
      instructions: settings?.promptInstructions ?? [],
      negativePrompt: settings?.negativePrompt ?? "",
      imageInputs: loaded.length,
      tier: tierInfo,
    });
    const size = resolveOpenAISize(model, model.defaultResolution, model.defaultAspectRatio);
    const quality = String(model.extra.quality?.default ?? "medium");
    try {
      const res = loaded.length
        ? await oaClient.edit({ model: model.endpoint, prompt: built.prompt, n: 1, size, quality, outputFormat: "png", images: loaded, signal })
        : await oaClient.generate({ model: model.endpoint, prompt: built.prompt, n: 1, size, quality, outputFormat: "png", signal });
      if (signal.aborted) return;
      const first = res.data?.[0];
      let buf: Buffer | null = null;
      let ct = "image/png";
      if (first?.b64_json) buf = Buffer.from(first.b64_json, "base64");
      else if (first?.url) {
        const dl = await download(first.url);
        if (dl.ok) {
          ct = dl.headers.get("content-type")?.split(";")[0] ?? "image/png";
          buf = Buffer.from(await dl.arrayBuffer());
        }
      }
      if (!buf) {
        const msg = `${room.name} (${tier.name}): empty provider output`;
        errors.push(msg);
        runState.errors.push(msg);
        return;
      }
      const prev = await savePreviewBlobToPlan(plan, room.id, tier.id, refs[0].ref.id, buf, ct, model.id);
      await flushPreview(prev);
      const idx = nextPreviews.findIndex((p) => p.roomId === prev.roomId && p.tierOfferingId === prev.tierOfferingId);
      if (idx >= 0) nextPreviews[idx] = prev;
      else nextPreviews.push(prev);
      generated++;
      runState.generated++;
    } catch (e) {
      if (signal.aborted || (e instanceof OpenAIError && e.httpStatus === 499)) return;
      const msg = `${room.name} (${tier.name}): ${e instanceof OpenAIError ? e.message : (e as Error).message}`;
      errors.push(msg);
      runState.errors.push(msg);
    } finally {
      if (!signal.aborted) runState.done++;
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, Math.max(1, tasks.length)) }, async () => {
    while (cursor < tasks.length && !signal.aborted) {
      const item = tasks[cursor++];
      if (item) await runOne(item);
    }
  });
  await Promise.all(workers);

  extSignal?.removeEventListener("abort", onAbort);
  runState.cancelled = signal.aborted;
  runState.status = signal.aborted ? "cancelled" : "completed";
  await audit("floorplan.previews", actorLabel(actor), "floorPlan", plan.id, {
    generated,
    skippedExisting,
    skippedNoRefs,
    errors: errors.length,
    cancelled: signal.aborted,
  });
  return { floorPlanId: plan.id, generated, skippedExisting, skippedNoRefs, errors, cancelled: signal.aborted, totalPreviews: nextPreviews.length };
}
