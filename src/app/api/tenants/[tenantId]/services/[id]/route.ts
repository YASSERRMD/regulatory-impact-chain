import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const updateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  departmentId: z.string().optional().nullable(),
  description: z.string().optional(),
  serviceType: z.enum(["Internal", "External", "Shared"]).optional(),
  status: z.enum(["Active", "Deprecated", "Planned"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/services/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const service = await db.service.findFirst({
      where: { id, tenantId },
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: service });
  } catch (error) {
    console.error("Error fetching service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch service" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/services/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateServiceSchema.parse(body);

    const existing = await db.service.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const service = await db.service.update({
      where: { id },
      data: validated,
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Service",
        entityId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: service,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: service });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update service" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/services/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const service = await db.service.findFirst({
      where: { id, tenantId },
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    await db.service.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Service",
        entityId: id,
        action: "DELETE",
        oldValues: service,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, message: "Service deactivated" });
  } catch (error) {
    console.error("Error deleting service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete service" },
      { status: 500 }
    );
  }
}
