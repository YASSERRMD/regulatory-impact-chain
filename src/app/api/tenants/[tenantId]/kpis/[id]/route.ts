import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const updateKPISchema = z.object({
  name: z.string().min(1).max(255).optional(),
  departmentId: z.string().optional().nullable(),
  description: z.string().optional(),
  unit: z.string().optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  measurementFrequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/kpis/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const kpi = await db.kPI.findFirst({
      where: { id, tenantId },
    });

    if (!kpi) {
      return NextResponse.json(
        { success: false, error: "KPI not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: kpi });
  } catch (error) {
    console.error("Error fetching KPI:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch KPI" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/kpis/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateKPISchema.parse(body);

    const existing = await db.kPI.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "KPI not found" },
        { status: 404 }
      );
    }

    const kpi = await db.kPI.update({
      where: { id },
      data: validated,
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "KPI",
        entityId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: kpi,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: kpi });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating KPI:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update KPI" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/kpis/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const kpi = await db.kPI.findFirst({
      where: { id, tenantId },
    });

    if (!kpi) {
      return NextResponse.json(
        { success: false, error: "KPI not found" },
        { status: 404 }
      );
    }

    await db.kPI.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "KPI",
        entityId: id,
        action: "DELETE",
        oldValues: kpi,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, message: "KPI deactivated" });
  } catch (error) {
    console.error("Error deleting KPI:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete KPI" },
      { status: 500 }
    );
  }
}
