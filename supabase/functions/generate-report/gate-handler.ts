import { AuthError } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";

export interface ReportGateDependencies {
  handleOptions(req: Request): Response | null;
  guardRequest(
    req: Request,
    options: { enforceCap: false },
  ): Promise<unknown>;
  jsonResponse(
    body: unknown,
    status: number,
    origin: string | null,
  ): Response;
  gatePayload: Record<string, unknown>;
  downstream: {
    readMemory(): Promise<unknown>;
    readDatabaseContent(): Promise<unknown>;
    reserveAllowance(): Promise<unknown>;
    callProvider(): Promise<unknown>;
  };
}

export async function handleGenerateReportGate(
  req: Request,
  dependencies: ReportGateDependencies,
): Promise<Response> {
  const options = dependencies.handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return dependencies.jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  try {
    await dependencies.guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return dependencies.jsonResponse(error.payload, error.status, origin);
    }
    return dependencies.jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  return dependencies.jsonResponse(dependencies.gatePayload, 409, origin);
}
