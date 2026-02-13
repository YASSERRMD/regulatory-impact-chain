import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const createServiceSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  departmentId: z.string().optional(),
  description: z.string().optional(),
  serviceType: z.enum(["Internal", "External", "Shared"]).optional(),
  status: z.enum(["Active", "Deprecated", "Planned"]).default("Active"),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/services
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const departmentId = searchParams.get("departmentId");
    const status = searchParams.get("status");

    const services = await db.service.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(departmentId && { departmentId }),
        ...(status && { status }),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ success: true, data: services });
  } catch (error) {
    console.error("Error fetching services:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/services
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createServiceSchema.parse(body);

    const existing = await db.service.findFirst({
      where: { tenantId, code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Service code already exists" },
        { status: 400 }
      );
    }

    const service = await db.service.create({
      data: {
        tenantId,
        ...validated,
        metadata: validated.metadata ?? {},
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Service",
        entityId: service.id,
        action: "CREATE",
        newValues: service,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: service }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create service" },
      { status: 500 }
    );
  }
}
