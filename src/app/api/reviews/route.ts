import { readJson, route } from "@/modules/core/api";
import { recordReview, reviewQueue } from "@/modules/review/service";

export const GET = route(async () => ({ queue: await reviewQueue() }));
export const POST = route(async (req) => ({ review: await recordReview(await readJson(req)) }));
