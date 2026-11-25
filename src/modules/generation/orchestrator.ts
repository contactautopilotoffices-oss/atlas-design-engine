import "server-only";
/**
 * Generation orchestration across Higgsfield (asynchronous polling) and OpenAI (synchronous):
 *   preview brief -> client confirms -> validate -> prepare references -> submit/execute
 *   -> store result in private generated-images storage -> unreviewed GeneratedAsset.
 * Submitting a room selection NEVER triggers generation; only an explicit, confirmed request does.
 */
import { z } from "zod";
import { audit } from "@/modules/core/audit";
import { ReferenceRole, RoomSpec, type DesignBrief, type GeneratedAsset, type GenerationJob } from "@/modules/core/schemas";
import { AppError, newId, notFound, now, randomToken } from "@/modules/core/util";
import { ALL_MODELS, buildRequestBody, getAnyModel, modelProvider, resolveOpenAISize, type ImageProvider, type ModelCapability } from "@/modules/generation/models";
import { higgsfieldClient, higgsfieldStatus } from "@/modules/higgsfield/config";
import { HiggsfieldError, mapStatus } from "@/modules/higgsfield/client";
import { openaiClient, openaiStatus } from "@/modules/openai/config";
import { OpenAIError } from "@/modules/openai/client";
import { loadLibraryContext } from "@/modules/intelligence/library";
import { checkEligibility, allMaterials } from "@/modules/offerings/eligibility";
import { blobs, repo } from "@/modules/persistence";
import { buildPrompt } from "@/modules/prompt/builder";
import { actorLabel, type Actor } from "@/modules/security/auth";
import { rateLimit } from "@/modules/security/rate-limit";
import { getAuthorisedSession } from "@/modules/selections/service";
import { toMetres } from "@/modules/spatial/validate";

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
  const selection = (await repo().list("selections", { sessionId })).find((s) => s.roomId === roomId);
  const specRec = (await repo().list("roomSpecs", { sessionId })).find((s) => s.roomId === roomId);
  const blockers: string[] = [];
  if (specRec && !specRec.isValid) blockers.push("The saved room measurements have errors. Fix them in Measure room, or clear them.");

  const eligible = ctx.refs.filter(
    (r) => r.metadata.roomTypeId === room.roomTypeId && (!offering || checkEligibility(r, offering, ctx.offerings).eligible),
  );
  const roles: Array<{ referenceId: string; role: z.infer<typeof ReferenceRole> }> = [];
  if (selection) roles.push({ referenceId: selection.referenceId, role: "primary" });
  for (const r of req.roles) if (!roles.some((x) => x.referenceId === r.referenceId)) roles.push(roles.length === 0 ? { ...r, role: "primary" } : r);
  if (roles.length === 0) eligible.slice(0, 3).forEach((r, i) => roles.push({ referenceId: r.id, role: i === 0 ? "primary" : "secondary" }));
  if (roles.length === 0 && !req.refinementOfAssetId) blockers.push("There are no approved pictures for this room type yet, so there is nothing to base new designs on. Approve some in Studio > Reference review.");
  const refs = roles.map((r) => {
    const ref = ctx.refs.find((x) => x.id === r.referenceId);
    if (!ref) throw notFound(`Reference ${r.referenceId}`);
    if (offering && !checkEligibility(ref, offering, ctx.offerings).eligible) throw new AppError(`${ref.referenceCode} is not available under the selected offering.`, 409);
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
  const roomTypeName = ctx.roomTypes.find((t) => t.id === (spec?.roomTypeId ?? room.roomTypeId))?.name ?? "room";
  const direction = ctx.directions.find((d) => d.id === refs[0]?.ref.metadata.designDirectionId);
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
  return { session, actor, room, brief, refs, refinement, blockers };
}

export async function previewBrief(sessionId: string, roomId: string, raw: unknown, modelId?: string) {
  const req = BriefRequest.parse(raw);
  const a = await assemble(sessionId, roomId, req);
  const settings = await repo().get("settings", "app");
  const model = resolveEffectiveModel(modelId, settings?.defaultModelId);
  const imageCount = (a.refinement ? 1 : 0) + a.refs.length;
  const sent = model.referenceField ? Math.min(imageCount, model.maxReferences) : 0;
  const built = buildPrompt(refineBrief(a.brief, a.refinement), { instructions: settings?.promptInstructions ?? [], negativePrompt: settings?.negativePrompt ?? "", imageInputs: sent });
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

async function storeGeneratedImage(job: Pick<GenerationJob, "id" | "sessionId" | "roomId">, index: number, data: Buffer, contentType: string, providerUrl: string | null) {
  const ct = contentType.split(";")[0].trim() || "image/png";
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const asset: GeneratedAsset = {
    id: newId("gen"),
    jobId: job.id,
    sessionId: job.sessionId,
    roomId: job.roomId,
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

export async function createGeneration(sessionId: string, roomId: string, raw: unknown) {
  const req = GenerateRequest.parse(raw);
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

  rateLimit(`gen:${sessionId}`, 6, 10 * 60_000);
  rateLimit("gen:global", 30, 10 * 60_000);

  const imageInputs: GenerationJob["referenceInputs"] = [];
  if (a.refinement) imageInputs.push({ referenceId: a.refinement.id, role: "primary", kind: "generated", providerUrl: null });
  for (const r of a.refs) imageInputs.push({ referenceId: r.ref.id, role: r.role, kind: "reference", providerUrl: null });
  const usable = model.referenceField ? imageInputs.slice(0, model.maxReferences) : [];
  if (usable.length < model.minReferences) throw new AppError(`${model.label} needs at least ${model.minReferences} reference image(s).`);

  const settings = await repo().get("settings", "app");
  const built = buildPrompt(refineBrief(a.brief, a.refinement), { instructions: settings?.promptInstructions ?? [], negativePrompt: settings?.negativePrompt ?? "", imageInputs: usable.length });
  const loadedBlobs = await loadInputBlobs(usable, a.refs, a.refinement);

  if (provider === "higgsfield" && hfClient) {
    // Upload the actual reference images once per batch (not just their names).
    for (const item of loadedBlobs) {
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
        };
        const res = loadedBlobs.length
          ? await oaClient.edit({ ...oaiReq, images: loadedBlobs.map((b) => ({ data: b.data, contentType: b.contentType, filename: b.filename })) })
          : await oaClient.generate(oaiReq);

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
        const msg = e instanceof OpenAIError ? e.message : "OpenAI image generation failed.";
        jobs.push(await repo().update("generationJobs", job.id, { status: "failed", error: msg, completedAt: now(), updatedAt: now() }));
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
