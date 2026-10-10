export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", release: process.env.APNADESIGN_RELEASE || "development" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
