import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const WISP_SECRET = process.env.WISP_SECRET;

function isAuthorized(request: Request): boolean {
  if (!WISP_SECRET) return true;
  return request.headers.get("x-wisp-token") === WISP_SECRET;
}

const http = httpRouter();

http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json() as { events: unknown[] };
    const geo = await resolveGeo(request);

    await ctx.runMutation(internal.events.recordBatchWithGeo, {
      events: body.events,
      geo,
    });

    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }),
});

http.route({
  path: "/ingest",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-wisp-token",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

async function resolveGeo(request: Request): Promise<{
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
}> {
  const ip = extractIp(request);

  // Cloudflare injects these on every proxied request — no cost, no API call.
  const cfCountry = request.headers.get("cf-ipcountry") ?? undefined;
  const cfRegion = request.headers.get("cf-region") ?? undefined;
  const cfCity = request.headers.get("cf-ipcity") ?? undefined;

  // If Cloudflare provides all geo fields, skip the API call.
  if (cfCountry && cfRegion && cfCity) {
    return { ip, country: cfCountry, region: cfRegion, city: cfCity };
  }

  // Fallback: geo-IP lookup when Cloudflare geo headers are incomplete
  // (cf-ipcountry is free, but cf-region and cf-ipcity require Business+).
  // ip-api.com free tier (45 req/min), no API key required.
  if (ip) {
    try {
      const res = await fetch(
        `https://ip-api.com/json/${ip}?fields=country,regionName,city`,
        { signal: AbortSignal.timeout(2000) }
      );
      if (res.ok) {
        const data = await res.json() as { country?: string; regionName?: string; city?: string };
        return {
          ip,
          country: cfCountry ?? data.country ?? undefined,
          region: cfRegion ?? data.regionName ?? undefined,
          city: cfCity ?? data.city ?? undefined,
        };
      }
    } catch {
      // Timeout or network error — return Cloudflare data (even partial) silently
    }
  }

  return { ip, country: cfCountry, region: cfRegion, city: cfCity };
}

function extractIp(request: Request): string | undefined {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const real = request.headers.get("x-real-ip");
  if (real) return real;

  return undefined;
}

export default http;
