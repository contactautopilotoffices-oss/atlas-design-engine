/**
 * ATLAS Design Engine: canonical data model.
 *
 * Every persisted record is described here with Zod, and the TypeScript types are
 * inferred from these schemas. Both persistence adapters (local JSON and Supabase)
 * store exactly these shapes. Nested blocks map to jsonb columns in Supabase.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const id = z.string().min(1);
const isoDate = z.string().min(1);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected a HEX colour like #A39A8B");

/** Where a metadata value came from. Keeps observed facts apart from interpretations. */
export const Provenance = z.enum(["observed", "human", "ai", "source-text"]);
export type Provenance = z.infer<typeof Provenance>;

// ---------------------------------------------------------------- configuration

export const SpatialProfile = z.object({
  /** Typical seat range used as one signal (never the only one) during room classification. */
  minSeats: z.number().int().nonnegative().nullable().default(null),
  maxSeats: z.number().int().nonnegative().nullable().default(null),
  /** Words in the stated purpose that point to this room type. */
  purposeKeywords: z.array(z.string()).default([]),
  /** Table arrangements typical for this room type. */
  tableArrangements: z.array(z.string()).default([]),
  /** Comfortable floor area per occupant in m2 (guideline, configurable). */
  areaPerPersonM2: z.number().positive().nullable().default(null),
});
export type SpatialProfile = z.infer<typeof SpatialProfile>;

export const RoomType = z.object({
  id,
  name: z.string().min(1),
  description: z.string().default(""),
  sortOrder: z.number().int().default(0),
  spatialProfile: SpatialProfile.default({
    minSeats: null,
    maxSeats: null,
    purposeKeywords: [],
    tableArrangements: [],
    areaPerPersonM2: null,
  }),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RoomType = z.infer<typeof RoomType>;

export const Material = z.object({
  id,
  name: z.string().min(1),
  category: z.string().default("general"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Material = z.infer<typeof Material>;

export const OfferingRules = z.object({
  /** "tagged": only references tagged with this offering (or explicitly included).
   *  "all-approved": every approved reference unless excluded by another rule. */
  mode: z.enum(["tagged", "all-approved"]).default("tagged"),
  /** Room types available under this offering. Empty list means all room types. */
  roomTypeIds: z.array(z.string()).default([]),
  /** Materials NOT available under this offering. References using them become ineligible. */
  excludedMaterialNames: z.array(z.string()).default([]),
  includeReferenceIds: z.array(z.string()).default([]),
  excludeReferenceIds: z.array(z.string()).default([]),
  /** Also allow references tagged for lower-ranked offerings. */
  inheritLowerTiers: z.boolean().default(false),
  /** Only approved references are eligible (recommended for client meetings). */
  requireApproved: z.boolean().default(true),
});
export type OfferingRules = z.infer<typeof OfferingRules>;

export const Offering = z.object({
  id,
  name: z.string().min(1),
  description: z.string().default(""),
  tierGuidance: z.string().default(""),
  rank: z.number().int().default(0),
  isDemo: z.boolean().default(false),
  rules: OfferingRules,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Offering = z.infer<typeof Offering>;

export const BoqBasis = z.enum(["floor_area_sqft", "wall_area_sqft", "ceiling_area_sqft", "seat_count", "room_fixed"]);
export type BoqBasis = z.infer<typeof BoqBasis>;

export const BoqCategory = z.enum(["civil_partitions", "flooring", "ceiling", "wall_finishes", "lighting_electrical", "furniture", "av_hvac_misc"]);
export type BoqCategory = z.infer<typeof BoqCategory>;

export const BoqItem = z.object({
  id,
  offeringId: z.string().min(1),
  category: BoqCategory,
  name: z.string().min(1),
  specification: z.string().default(""),
  unit: z.string().min(1),
  basis: BoqBasis,
  multiplier: z.number().positive().default(1),
  unitRate: z.number().nonnegative(),
  roomTypeIds: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
  isDemo: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type BoqItem = z.infer<typeof BoqItem>;

export const Property = z.object({
  id,
  name: z.string().min(1),
  city: z.string().default(""),
  address: z.string().default(""),
  isDemo: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Property = z.infer<typeof Property>;

export const FloorPlanRoom = z.object({
  id,
  code: z.string().min(1),
  name: z.string().min(1),
  roomTypeId: z.string().min(1),
  /** Polygon in plan units, clockwise. */
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  /** Known measured dimensions for this space, if supplied by drawings. */
  dimensions: z
    .object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive().nullable() })
    .nullable()
    .default(null),
  /** Text read off the drawing for this room, when it was found automatically. */
  labelText: z.string().default(""),
  /** How sure the automatic room finder was. Null when the room was drawn or entered by a person. */
  confidence: z.enum(["high", "medium", "low"]).nullable().default(null),
});
export type FloorPlanRoom = z.infer<typeof FloorPlanRoom>;

export const FloorPlanPreview = z.object({
  id,
  roomId: z.string(),
  tierOfferingId: z.string(),
  referenceId: z.string(),
  blobKey: z.string(),
  mimeType: z.string().default("image/png"),
  modelId: z.string(),
  createdAt: isoDate,
});
export type FloorPlanPreview = z.infer<typeof FloorPlanPreview>;

export const FloorPlan = z.object({
  id,
  propertyId: z.string().min(1),
  name: z.string().min(1),
  isSample: z.boolean().default(false),
  sampleNotice: z.string().default(""),
  unit: z.enum(["m", "ft"]).default("m"),
  width: z.number().positive(),
  height: z.number().positive(),
  rooms: z.array(FloorPlanRoom),
  /** Drafts are imported plans waiting for a person to check them. Clients only ever see published plans. */
  status: z.enum(["draft", "published"]).default("published"),
  /** Where the plan came from. Null for plans entered by hand or seeded. */
  source: z
    .object({ kind: z.enum(["pdf", "image", "dxf"]), fileName: z.string(), page: z.number().int().positive().nullable() })
    .nullable()
    .default(null),
  /** The drawing itself, shown underneath the clickable rooms. Spans 0..width x 0..height. */
  background: z.object({ key: z.string(), pixelWidth: z.number().positive(), pixelHeight: z.number().positive() }).nullable().default(null),
  /**
   * How the plan's size in metres was decided. "drawing" = read from a DXF in real units,
   * "confirmed" = a person confirmed or typed it, "ai_estimate" = guessed and not yet checked.
   */
  scale: z
    .object({ method: z.enum(["drawing", "confirmed", "ai_estimate"]), metresPerPixel: z.number().positive().nullable(), note: z.string().default("") })
    .nullable()
    .default(null),
  previews: z.array(FloorPlanPreview).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type FloorPlan = z.infer<typeof FloorPlan>;

export const AppSettings = z.object({
  id: z.literal("app"),
  promptInstructions: z.array(z.string()),
  negativePrompt: z.string(),
  defaultModelId: z.string(),
  currency: z.string().default("INR"),
  updatedAt: isoDate,
});
export type AppSettings = z.infer<typeof AppSettings>;

// ---------------------------------------------------------------- reference library

export const Project = z.object({
  id,
  name: z.string().min(1),
  clientName: z.string().default(""),
  propertyName: z.string().default(""),
  city: z.string().default(""),
  category: z.string().default(""),
  isDemo: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Project = z.infer<typeof Project>;

export const DocumentKind = z.enum(["pdf", "pptx", "image"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const ProcessingStatus = z.enum(["uploaded", "processing", "processed", "partial", "failed"]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

export const PdfScanSummary = z.object({
  model: z.string(),
  scannedAt: isoDate,
  projectDetails: z
    .object({
      projectName: z.string().nullable().default(null),
      location: z.string().nullable().default(null),
      date: z.string().nullable().default(null),
      presentedBy: z.string().nullable().default(null),
    })
    .default({ projectName: null, location: null, date: null, presentedBy: null }),
  moodBoard: z
    .object({
      page: z.number().int().positive().nullable().default(null),
      styleSummary: z.string().default(""),
      colorPalette: z.array(z.object({ name: z.string(), hex: z.string().nullable().default(null) })).default([]),
      materialPalette: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  layoutLegend: z
    .array(
      z.object({
        name: z.string(),
        capacity: z.string().default(""),
        count: z.number().int().positive().nullable().default(null),
      }),
    )
    .default([]),
  floorPlanId: z.string().nullable().default(null),
  floorPlanError: z.string().nullable().default(null),
});
export type PdfScanSummary = z.infer<typeof PdfScanSummary>;

export const SourceDocument = z.object({
  id,
  projectId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string(),
  kind: DocumentKind,
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  blobKey: z.string(),
  status: ProcessingStatus,
  pageCount: z.number().int().nonnegative().nullable().default(null),
  extractedImageCount: z.number().int().nonnegative().default(0),
  duplicateImageCount: z.number().int().nonnegative().default(0),
  /** Logos, icons and other small pictures that were left out on purpose. */
  skippedSmallCount: z.number().int().nonnegative().default(0),
  pageText: z.array(z.object({ page: z.number().int(), text: z.string() })).default([]),
  errors: z.array(z.object({ page: z.number().int().nullable(), message: z.string() })).default([]),
  pdfScan: PdfScanSummary.nullable().default(null),
  uploadedAt: isoDate,
  processedAt: isoDate.nullable().default(null),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const ColourSwatch = z.object({ hex, share: z.number().min(0).max(1) });
export type ColourSwatch = z.infer<typeof ColourSwatch>;

export const ReferenceMetadata = z.object({
  roomTypeId: z.string().nullable().default(null),
  designDirectionId: z.string().nullable().default(null),
  designLanguage: z.string().nullable().default(null),
  visualCharacteristics: z.array(z.string()).default([]),
  architecturalLanguage: z.string().nullable().default(null),
  designIntent: z.string().nullable().default(null),
  colors: z
    .object({
      primary: hex.nullable().default(null),
      secondary: hex.nullable().default(null),
      tertiary: hex.nullable().default(null),
      palette: z.array(ColourSwatch).default([]),
    })
    .default({ primary: null, secondary: null, tertiary: null, palette: [] }),
  materials: z
    .object({
      flooring: z.array(z.string()).default([]),
      walls: z.array(z.string()).default([]),
      ceiling: z.array(z.string()).default([]),
      furniture: z.array(z.string()).default([]),
      surfaces: z.array(z.string()).default([]),
      other: z.array(z.string()).default([]),
    })
    .default({ flooring: [], walls: [], ceiling: [], furniture: [], surfaces: [], other: [] }),
  lighting: z
    .object({
      natural: z.string().nullable().default(null),
      artificial: z.string().nullable().default(null),
      ambient: z.string().nullable().default(null),
      accent: z.string().nullable().default(null),
      temperatureK: z.number().int().positive().nullable().default(null),
    })
    .default({ natural: null, artificial: null, ambient: null, accent: null, temperatureK: null }),
  furniture: z
    .object({
      types: z.array(z.string()).default([]),
      arrangement: z.string().nullable().default(null),
      partitions: z.string().nullable().default(null),
      doorsWindows: z.string().nullable().default(null),
      composition: z.string().nullable().default(null),
      distinctiveElements: z.array(z.string()).default([]),
    })
    .default({ types: [], arrangement: null, partitions: null, doorsWindows: null, composition: null, distinctiveElements: [] }),
  classification: z
    .object({
      designCategory: z.string().nullable().default(null),
      offeringIds: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
    })
    .default({ designCategory: null, offeringIds: [], tags: [], keywords: [] }),
  /** Never inferred from a photograph. Only from drawings, supplied measurements or verified source text. */
  dimensions: z
    .object({
      length: z.number().positive().nullable().default(null),
      width: z.number().positive().nullable().default(null),
      height: z.number().positive().nullable().default(null),
      unit: z.enum(["m", "ft"]).default("m"),
      source: z.enum(["architectural-drawing", "supplied-measurement", "verified-source-text"]).nullable().default(null),
      confidence: z.enum(["high", "medium", "low"]).nullable().default(null),
    })
    .default({ length: null, width: null, height: null, unit: "m", source: null, confidence: null }),
  notes: z.string().default(""),
});
export type ReferenceMetadata = z.infer<typeof ReferenceMetadata>;

export const ReviewStatus = z.enum(["pending", "approved", "rejected", "needs_review"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const ReferenceAsset = z.object({
  id,
  /** Human-friendly unique code, e.g. REF-00001. */
  referenceCode: z.string().regex(/^REF-\d{5,}$/),
  projectId: z.string().min(1),
  documentId: z.string().min(1),
  sourceFilename: z.string(),
  sourceKind: z.enum(["pdf-page", "pptx-slide", "image-file"]),
  /** PDF page or PPTX slide number (1-based). Null for standalone images. */
  sourcePage: z.number().int().positive().nullable(),
  sourceText: z.string().default(""),
  imageSha256: z.string().length(64),
  blobKey: z.string(),
  thumbKey: z.string(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  metadata: ReferenceMetadata,
  /** Field path -> where that value came from. */
  provenance: z.record(z.string(), Provenance).default({}),
  analysis: z
    .object({
      provider: z.string().nullable().default(null),
      status: z.enum(["not_configured", "pending", "completed", "failed"]).default("not_configured"),
      error: z.string().nullable().default(null),
      analysedAt: isoDate.nullable().default(null),
      imageRole: z.enum(["design_render", "key_plan", "floor_plan", "mood_board", "logo_or_other"]).nullable().default(null),
      summary: z.string().nullable().default(null),
    })
    .default({ provider: null, status: "not_configured", error: null, analysedAt: null, imageRole: null, summary: null }),
  reviewStatus: ReviewStatus,
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: isoDate.nullable().default(null),
  isDemo: z.boolean().default(false),
  schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ReferenceAsset = z.infer<typeof ReferenceAsset>;

export const DesignDirection = z.object({
  id,
  name: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(["suggested", "approved", "archived"]),
  source: z.enum(["discovered", "manual", "merged"]),
  referenceIds: z.array(z.string()).default([]),
  signature: z
    .object({
      materials: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      palette: z.array(hex).default([]),
    })
    .default({ materials: [], keywords: [], palette: [] }),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type DesignDirection = z.infer<typeof DesignDirection>;

// ---------------------------------------------------------------- client sessions & selections

export const DesignSession = z.object({
  id,
  /** SHA-256 of the browser's private session token. The raw token is never stored. */
  ownerTokenHash: z.string(),
  propertyId: z.string(),
  floorPlanId: z.string(),
  offeringId: z.string(),
  clientName: z.string().default(""),
  status: z.enum(["active", "submitted_for_review", "closed"]).default("active"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type DesignSession = z.infer<typeof DesignSession>;

export const ReferenceSnapshot = z.object({
  referenceCode: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  sourceFilename: z.string(),
  sourcePage: z.number().int().nullable(),
});
export type ReferenceSnapshot = z.infer<typeof ReferenceSnapshot>;

/** Current submitted choice for one room in one session. Only created by Submit Choice. */
export const DesignSelection = z.object({
  id,
  sessionId: z.string(),
  roomId: z.string(),
  roomTypeId: z.string(),
  /** The library reference chosen, or the reference an AI concept was generated from. */
  referenceId: z.string(),
  /** Set when the client chose an AI-generated concept instead of a library picture. */
  generatedAssetId: z.string().nullable().default(null),
  snapshot: ReferenceSnapshot,
  offeringId: z.string(),
  revision: z.number().int().positive(),
  submittedAt: isoDate,
});
export type DesignSelection = z.infer<typeof DesignSelection>;

export const SelectionRevision = DesignSelection.omit({ id: true }).extend({
  id,
  selectionId: z.string(),
  note: z.string().default(""),
});
export type SelectionRevision = z.infer<typeof SelectionRevision>;

// ---------------------------------------------------------------- measured scene

export const Wall = z.enum(["north", "east", "south", "west"]);
export type Wall = z.infer<typeof Wall>;

export const Opening = z.object({
  id,
  wall: Wall,
  /** Distance from the wall's start corner to the opening's near edge. */
  offset: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  sillHeight: z.number().nonnegative().default(0),
});
export type Opening = z.infer<typeof Opening>;

export const Block = z.object({
  id,
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  d: z.number().positive(),
  h: z.number().positive().nullable().default(null),
});
export type Block = z.infer<typeof Block>;

export const FurnitureRequirement = z.object({
  id,
  type: z.string().min(1),
  count: z.number().int().positive(),
  w: z.number().positive(),
  d: z.number().positive(),
  h: z.number().positive(),
});
export type FurnitureRequirement = z.infer<typeof FurnitureRequirement>;

export const RoomSpec = z.object({
  unit: z.enum(["m", "ft"]).default("m"),
  length: z.number(),
  width: z.number(),
  height: z.number(),
  roomTypeId: z.string().nullable(),
  intendedUse: z.string().default(""),
  occupancy: z.number().int().nonnegative(),
  tableArrangement: z.string().default(""),
  doors: z.array(Opening).default([]),
  windows: z.array(Opening).default([]),
  columns: z.array(Block).default([]),
  obstructions: z.array(Block).default([]),
  furniture: z.array(FurnitureRequirement).default([]),
  circulationClearance: z.number().nonnegative().default(0.9),
});
export type RoomSpec = z.infer<typeof RoomSpec>;

export const ValidationIssue = z.object({
  level: z.enum(["error", "warning", "review"]),
  field: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ClassificationResult = z.object({
  suggestedRoomTypeId: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  scores: z.array(z.object({ roomTypeId: z.string(), score: z.number(), reasons: z.array(z.string()) })),
  contradictions: z.array(z.string()),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;

export const RoomSpecRecord = z.object({
  id,
  sessionId: z.string(),
  roomId: z.string(),
  spec: RoomSpec,
  issues: z.array(ValidationIssue),
  classification: ClassificationResult,
  isValid: z.boolean(),
  updatedAt: isoDate,
});
export type RoomSpecRecord = z.infer<typeof RoomSpecRecord>;

// ---------------------------------------------------------------- generation

export const ReferenceRole = z.enum(["primary", "secondary", "colour", "material", "lighting", "layout"]);
export type ReferenceRole = z.infer<typeof ReferenceRole>;

export const GenerationStatus = z.enum(["draft", "submitted", "queued", "processing", "completed", "failed", "cancelled"]);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

export const DesignBrief = z.object({
  roomTypeName: z.string(),
  intendedUse: z.string(),
  occupancy: z.number().int().nonnegative(),
  designObjective: z.string().default(""),
  designDirection: z.string().nullable(),
  dimensions: z.object({ length: z.number(), width: z.number(), height: z.number(), unit: z.enum(["m", "ft"]) }),
  doors: z.array(z.string()),
  windows: z.array(z.string()),
  fixedConstraints: z.array(z.string()),
  colours: z.object({ primary: z.string().nullable(), secondary: z.string().nullable(), tertiary: z.string().nullable() }),
  materials: z.array(z.string()),
  lighting: z.array(z.string()),
  furniture: z.array(z.string()),
  references: z.array(
    z.object({ referenceId: z.string(), referenceCode: z.string(), projectName: z.string(), role: ReferenceRole }),
  ),
});
export type DesignBrief = z.infer<typeof DesignBrief>;

export const GenerationJob = z.object({
  id,
  batchId: z.string(),
  sessionId: z.string(),
  roomId: z.string(),
  status: GenerationStatus,
  modelId: z.string(),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  brief: DesignBrief,
  prompt: z.string(),
  negativePrompt: z.string().default(""),
  referenceInputs: z.array(
    z.object({
      referenceId: z.string(),
      role: ReferenceRole,
      kind: z.enum(["reference", "generated"]),
      providerUrl: z.string().nullable().default(null),
    }),
  ),
  refinementOfAssetId: z.string().nullable().default(null),
  tierOfferingId: z.string().nullable().default(null),
  idempotencyKey: z.string(),
  providerRequestId: z.string().nullable().default(null),
  providerStatusUrl: z.string().nullable().default(null),
  providerCancelUrl: z.string().nullable().default(null),
  providerRawStatus: z.string().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  nextPollAt: isoDate.nullable().default(null),
  error: z.string().nullable().default(null),
  costNote: z.string().default("Not reported by provider; see the Higgsfield console for billing."),
  outputAssetIds: z.array(z.string()).default([]),
  createdBy: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
  submittedAt: isoDate.nullable().default(null),
  completedAt: isoDate.nullable().default(null),
});
export type GenerationJob = z.infer<typeof GenerationJob>;

export const GeneratedAsset = z.object({
  id,
  jobId: z.string(),
  sessionId: z.string(),
  roomId: z.string(),
  tierOfferingId: z.string().nullable().default(null),
  blobKey: z.string(),
  providerUrl: z.string().nullable(),
  mimeType: z.string(),
  reviewStatus: z.enum(["unreviewed", "approved", "rejected", "iteration_requested"]),
  isHandoffAsset: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type GeneratedAsset = z.infer<typeof GeneratedAsset>;

export const DesignerReview = z.object({
  id,
  sessionId: z.string(),
  roomId: z.string(),
  generatedAssetId: z.string().nullable(),
  action: z.enum(["comment", "approve", "reject", "request_iteration"]),
  comment: z.string().default(""),
  reviewer: z.string(),
  createdAt: isoDate,
});
export type DesignerReview = z.infer<typeof DesignerReview>;

export const AuditEntry = z.object({
  id,
  action: z.string(),
  actor: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
  at: isoDate,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

// ---------------------------------------------------------------- collection registry

export const Collections = {
  roomTypes: RoomType,
  materials: Material,
  offerings: Offering,
  boqItems: BoqItem,
  properties: Property,
  floorPlans: FloorPlan,
  settings: AppSettings,
  projects: Project,
  sourceDocuments: SourceDocument,
  references: ReferenceAsset,
  designDirections: DesignDirection,
  designSessions: DesignSession,
  selections: DesignSelection,
  selectionRevisions: SelectionRevision,
  roomSpecs: RoomSpecRecord,
  generationJobs: GenerationJob,
  generatedAssets: GeneratedAsset,
  designerReviews: DesignerReview,
  auditLog: AuditEntry,
} as const;

export type CollectionName = keyof typeof Collections;
export type RecordOf<C extends CollectionName> = z.infer<(typeof Collections)[C]>;
export const COLLECTION_NAMES = Object.keys(Collections) as CollectionName[];
