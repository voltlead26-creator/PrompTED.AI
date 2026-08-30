import type { NextRequest } from "next/server";
import { proxyEdgeFunctionRequest } from "@/lib/edge-function-proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ segments: string[] }>;
}

async function handle(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  return proxyEdgeFunctionRequest(request, segments);
}

export const DELETE = handle;
export const GET = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
