# ATLAS Design Engine: architecture

## Principles

- One Next.js app (App Router). No extra microservices.
- All business logic lives in `src/modules/*` and has no UI imports. Route handlers in `src/app/api` are thin: validate input (Zod), check who is asking, call a module, return JSON.
- Storage sits behind two interfaces (`Repository`, `BlobStore`), so local JSON, Supabase or the main ATLAS database can be swapped without UI changes.
- Provider-specific code (Higgsfield, email, vision) is isolated behind adapters.
- Nothing is reported as live unless it is: `src/modules/core/status.ts` computes every badge from real configuration.

## Modules

| Module | Folder | Responsibility |
| --- | --- | --- |
| Core | `core/` | Zod schemas for every record (`schemas.ts`), env validation, bootstrap config, audit log, admin config CRUD, demo content, status registry |
| Persistence | `persistence/` | `Repository` and `BlobStore` interfaces; local JSON (`.atlas-design/store.json`, atomic writes, process mutex + lock file); Supabase adapter |
| Reference ingestion | `ingestion/` | File validation by bytes, PDF (unpdf) and PPTX (JSZip, presentation order, slide relationships) extraction, image normalisation, thumbnails, pixel-sampled palette, de-duplication by decoded-pixel hash |
| Image analysis | `analysis/` | `VisionProvider` interface. None configured, so metadata comes from human review |
| Design intelligence | `intelligence/` | Text/attribute search, colour matching (Lab Delta E), explainable attribute similarity, recurring patterns, project-unique traits, design direction discovery (deterministic k-medoids, max 4), reference views |
| Offerings | `offerings/` | Eligibility rules driven entirely by `Offering.rules` |
| Client selections | `selections/` | Sessions owned by a private browser token, Submit Choice with revision numbers under an exclusive lock, session summary |
| Spatial geometry | `spatial/` | Room spec validation (metres or feet), multi-signal room classification (no single size cut-off), deterministic scene model for the 3D view |
| Prompt construction | `prompt/` | Pure brief-to-prompt builder; instruction lines are editable in Admin |
| Higgsfield provider | `higgsfield/` | Documented model capabilities, request body builder (documented fields only), API client (auth, idempotency, uploads, retries, status, cancel), credential resolution |
| Generation orchestration | `generation/` | Brief preview, confirmed submission, reference uploads, backoff polling, result download into storage, cancellation |
| Designer review | `review/` | Approve, reject, request iteration, comment; only approval creates a handoff asset |
| Client handoff | `handoff/` | Final summary and the email adapter (Resend), disabled unless configured |
| Security | `security/` | Staff roles (signed cookie), client token hashing, rate limiting |

## Main flows

**Ingestion**: upload -> `detectKind` (magic bytes) -> store original in `source-documents` -> extract per page/slide -> for each image: normalise, hash pixels, skip duplicates, store image + thumbnail, sample palette -> `ReferenceAsset` with `reviewStatus: pending`.

**Client selection**: start session (sets httpOnly token cookie, stores only its hash) -> click room -> gallery filtered by room type and offering eligibility -> select (browser state only) -> Submit Choice -> `DesignSelection` (current) + `SelectionRevision` (history).

**Generation**: room must have a submitted choice and a valid measured spec -> brief preview -> explicit confirmation -> upload reference images to Higgsfield (`files/generate-upload-url`, then PUT) -> submit with `Idempotency-Key` -> store `request_id` -> browser polls `/api/generation/jobs/:id`, server polls Higgsfield at most every 2 to 10 s -> on completion download images to `generated-images` -> `GeneratedAsset` (unreviewed).

## API contracts (summary)

All responses are JSON. Errors: `{ error, code, issues? }` with an HTTP status.

| Method and path | Who | Purpose |
| --- | --- | --- |
| GET `/api/status` | anyone | Live/planned status of every stage |
| GET/POST/DELETE `/api/staff/session` | anyone | Staff sign-in state, sign in with passcode, sign out |
| GET `/api/config` | anyone | Room types, offerings, properties, floor plans, approved directions |
| GET `/api/references?roomTypeId&offeringId&projectId&material&colour&q...` | anyone (clients see approved only) | Gallery search |
| GET/PATCH `/api/references/:id` | GET anyone (approved), PATCH staff | Detail with similar references; edit metadata and review status |
| GET/POST `/api/projects`, GET `/api/projects/:id` | staff (POST admin) | Projects with counts and documents |
| POST `/api/projects/:id/upload` | admin | Multipart field `files` |
| GET `/api/intelligence` | staff | Patterns, unique traits, direction suggestions |
| POST `/api/directions`, PATCH `/api/directions/:id`, POST `/api/directions/merge` | admin | Manage design directions |
| GET/POST `/api/sessions` | client | My sessions; start a session |
| GET/PATCH `/api/sessions/:id` | owner or staff | Summary; change offering |
| POST `/api/sessions/:id/selections` | owner or staff | Submit Choice `{ roomId, referenceId }` |
| GET/PUT `/api/sessions/:id/rooms/:roomId/spec` | owner or staff | Measured room |
| POST `/api/spatial/evaluate` | anyone | Validate a spec and return the scene model (no save) |
| POST `/api/sessions/:id/rooms/:roomId/brief` | owner or staff | Brief and prompt preview |
| GET/POST `/api/sessions/:id/rooms/:roomId/generate` | owner or staff | Job list; start generation (`confirmed: true` required) |
| GET `/api/generation/jobs/:id`, POST `.../cancel` | owner or staff | Poll / cancel |
| GET `/api/generation/jobs` | staff | All jobs |
| GET/POST `/api/reviews` | staff | Review queue; record review action |
| GET/POST `/api/handoff/:sessionId` | GET owner or staff, POST staff | Summary; send email |
| `/api/admin/:collection[/:id]` | admin | Config CRUD (roomTypes, materials, offerings, properties, floorPlans, projects, settings) |
| POST/DELETE `/api/admin/demo` | admin | Load or remove labelled demo content |
| GET `/api/admin/audit` | admin | Audit log |
| GET `/api/assets/:bucket/:key` | per bucket | Streams files with access checks |

## Data model

Defined once in `src/modules/core/schemas.ts`, mirrored in `supabase/migrations/`.

```
properties 1-* floor_plans (rooms as jsonb polygons)
projects 1-* source_documents 1-* reference_assets 0-1 reference_embeddings
design_directions *-* reference_assets (reference_ids)
offerings (rules jsonb) -- eligibility --> reference_assets
design_sessions (owner_token_hash) 1-* design_selections (one per room) 1-* selection_revisions
design_sessions 1-* room_specs (one per room)
design_sessions 1-* generation_jobs 1-* generated_assets 1-* designer_reviews
audit_log, app_settings, atlas_sequences (REF codes)
```

Unique constraints protect integrity: `(project_id, sha256)` on documents, `(project_id, image_sha256)` on references, `(session_id, room_id)` on selections and specs, `(session_id, room_id, revision)` on revisions.

## Storage

Six private buckets (local folders under `.atlas-design/blobs/` or Supabase Storage): `source-documents`, `reference-images`, `reference-thumbnails`, `floor-plans`, `generated-images`, `supporting-assets`. Originals and generated outputs never share a bucket. Nothing is public; `/api/assets` checks access (source files: staff only; reference images: staff or approved; generated images: staff or the owning session).

## Security

- Secrets only in server env; `server-only` guards stop server modules being bundled into the browser.
- Supabase: RLS enabled on every table with no anon/authenticated policies; the server uses the service-role key.
- Staff: HMAC-signed cookies; production refuses to run Studio without a passcode and session secret.
- Clients: random token in an httpOnly cookie; only its SHA-256 is stored; every session, job and generated image is ownership-checked.
- Rate limits on sign-in, sessions, uploads, generation and email. Audit log for important actions. Errors never echo secrets.

## Environment

See `.env.example`. Only Higgsfield, staff passcodes and (for cloud) Supabase are needed to run every stage.

## Future ATLAS integration points

- Import `src/modules/*` directly; they depend only on the `Repository`/`BlobStore` interfaces, so ATLAS can supply its own implementations.
- Replace staff passcodes with ATLAS's user accounts by changing `security/auth.ts` (`currentActor`, `requireStaff`).
- Properties and floor plans can be fed from ATLAS's property records through the `properties` / `floorPlans` collections.
- Add a `VisionProvider` (analysis) and an embedding provider (pgvector `reference_embeddings`) without touching the UI.
- Webhooks from Higgsfield can replace polling by calling the same `refreshJob` logic.
