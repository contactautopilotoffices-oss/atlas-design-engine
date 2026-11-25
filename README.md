# ATLAS Design Engine

Turns our completed interior projects into a searchable design library that clients can explore during a meeting: open a property's floor plan, click a room, browse matching references from real projects, select and submit choices, then (next stage) measure the room, generate new concepts with Higgsfield AI, get designer approval and hand off a final summary.

It is a standalone Next.js app, built so its modules can later move into the main ATLAS platform.

## What is live and what is not

Open **Studio > Status** in the running app. It is computed from the server's real configuration, never hardcoded:

| Stage | State |
| --- | --- |
| Upload PDF / PPTX / JPG / PNG / WEBP, extract images and text with page/slide numbers | Live |
| Source-linked reference records (REF-00001), human review and approval | Live |
| Searchable gallery with offering eligibility | Live (text and attribute search; vector search not active) |
| Floor plan, room selection, Submit Choice, revisions in `.atlas-design/store.json` | Live |
| Measured room with validation and a dimensioned 3D model | Live |
| Designer approval and printable handoff summary | Live |
| Higgsfield AI visualisation | Built and tested against a mocked API. Needs one real run on your machine (see below) |
| Supabase cloud storage | Built (adapter + SQL migrations tested on Postgres). Needs a Supabase project |
| Automated image analysis (vision AI) | Planned. No vision provider configured; your team fills metadata in Review |
| Email of the final summary | Built. Needs `RESEND_API_KEY` and `ATLAS_EMAIL_FROM` |

Submitting a room choice only saves it. It never generates an image or sends an email.

## Run it locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

- **Client workspace**: `/` then "Open Andheri Atlas".
- **Studio** (staff): `/studio`. With no passcode set, Studio is open on your own computer only and a yellow banner says so. Set `ATLAS_ADMIN_PASSCODE` before sharing the app.

Your existing `.env` is used as is. Copy any extra settings you need from `.env.example`.

### How to use it (4 steps)

0. **Floor plan**: Studio > Floor plans. Upload the plan as DXF (exact sizes, read straight from the drawing), or as a PDF or picture (Claude finds the rooms; needs `ANTHROPIC_API_KEY`). DWG files: save as DXF in AutoCAD first. Check the size, fix any room names or types, drag a box over anything missed, then press Publish. Clients only see published plans.
1. **Upload**: Studio > Projects & uploads. Create a project and drop in its PDFs, PowerPoints or images. Logos, icons and small key plans are left out automatically.
2. **Review**: Studio > Reference review. For each picture, click its room (the app pre-selects one when the slide title names it, e.g. "CONFERENCE ROOM"), or click "Not a design". "Accept all suggestions" does the whole batch in one click. Only approved pictures reach clients.
3. **Show clients**: Workspace > pick the property > Open. Clicking a room opens 4 design options from your projects. "Show more" loads more; "Create 4 new designs with AI" makes new ones with Higgsfield (asks once because it uses credits). Choosing an option saves it.

Optional: Administration > Offerings (rename tiers, exclude materials) and Administration > Demo content (sample DEMO pictures for rehearsing).

### Where data is kept

Locally everything is in `.atlas-design/` in the project folder (ignored by git):

- `store.json`: all records (projects, references, sessions, selections with revisions, jobs, reviews, audit log). Written atomically with a lock, so it survives refreshes, crashes and restarts.
- `blobs/`: original presentations, extracted images, thumbnails and generated images, in separate folders.

Back up that folder to keep your local data.

## Higgsfield AI

The app reads your existing key from `.env`. It accepts `HF_API_KEY_ID` + `HF_API_KEY_SECRET` (the names in Higgsfield's docs), `HIGGSFIELD_API_KEY=id:secret`, or the existing `HIGGSFIELF_API_KEY` name. The key never leaves the server and is never printed.

```bash
npm run check:higgsfield      # free: confirms the key is accepted, uses no credits
```

Models wired in, from the official docs:

- **Grok Image 2.0** (`xai/grok-imagine-image-2.0`, default): up to 10 reference images, so the client's chosen project photos are sent as real images with roles (primary, colour, material, lighting, layout).
- **Qwen Image 3 Edit** (`alibaba/qwen-image-3/edit`): 1 to 3 reference images, supports a negative prompt.
- **Soul Standard** (`higgsfield-ai/soul/standard`): text only; the app warns that references are only described in words.

Every generation needs an explicit confirmation, is rate-limited, records its model, settings, references and provider request id, and polls in the background. Results are copied into our own storage (provider links expire). AI images are never auto-approved, and the app states that AI output does not certify dimensions.

Optional paid test (spends credits): `ATLAS_ENABLE_LIVE_HIGGSFIELD_TEST=1 npm run test:live`.

## Tests

```bash
npm run typecheck
npm run lint
npm test            # 46 unit and integration tests, no network, no credits
npm run test:e2e    # builds, starts the real server, runs the full flow including a server restart
```

## Deploying to Vercel

`vercel.json` turns off automatic deployments on git push, so deployments happen only when you choose.

1. **Create a Supabase project** (Vercel's filesystem is temporary, so the local store cannot be used there).
2. Run the SQL in `supabase/migrations/` in order (Supabase dashboard > SQL editor, or `supabase db push`). This creates the tables, row level security and the six private storage buckets.
3. In Vercel > Project > Settings > Environment Variables add: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ATLAS_ADMIN_PASSCODE`, `ATLAS_DESIGNER_PASSCODE`, `ATLAS_SESSION_SECRET` (long random text), and your Higgsfield key.
4. Deploy manually: Vercel dashboard > Deployments > "Deploy", or `npx vercel --prod`.
5. Open `/studio` on the deployed site and check Status. If Supabase is not configured on Vercel, a banner warns that data is temporary.

Known Vercel limit: a single upload request is capped at about 4.5 MB on Vercel serverless functions. Large presentations should be uploaded from the locally running app until direct-to-storage uploads are added.

## Project layout

```
src/modules/      business logic, no UI (each folder is one module, see docs/ARCHITECTURE.md)
src/app/api/      server routes (all validation, access checks, provider calls)
src/app/          client pages (workspace, library, studio)
src/components/   shared UI
supabase/migrations/  database schema, RLS, storage buckets
tests/            unit, integration, end-to-end and optional live tests
```

See `docs/ARCHITECTURE.md` for module responsibilities, API contracts, the data model, storage and ATLAS integration points.

## License

Proprietary © Autopilot Offices.
