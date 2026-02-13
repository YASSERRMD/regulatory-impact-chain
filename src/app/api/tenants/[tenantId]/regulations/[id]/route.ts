import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

// Validation schema for regulation update
const updateRegulationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  departmentId: z.string().optional().nullable(),
  regulationType: z.enum(["Compliance", "Policy", "Standard", "Law"]).optional(),
  effectiveDate: z.string().transform((v) => new Date(v)).optional(),
  expirationDate: z.string().transform((v) => new Date(v)).optional().nullable(),
  status: z.enum(["Draft", "Active", "Superseded", "Revoked"]).optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
  enforcementParams: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/regulations/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const regulation = await db.regulation.findFirst({
      where: { id, tenantId },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
        impacts: {
          take: 100,
          orderBy: { propagatedAt: "desc" },
        },
        _count: {
          select: { impacts: true, childRegulations: true },
        },
      },
    });

    if (!regulation) {
      return NextResponse.json(
        { success: false, error: "Regulation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...regulation,
        impactCount: regulation._count.impacts,
        childRegulationCount: regulation._count.childRegulations,
        _count: undefined,
      },
    });
  } catch (error) {
    console.error("Error fetching regulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch regulation" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/regulations/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateRegulationSchema.parse(body);

    const existingRegulation = await db.regulation.findFirst({
      where: { id, tenantId },
    });

    if (!existingRegulation) {
      return NextResponse.json(
        { success: false, error: "Regulation not found" },
        { status: 404 }
      );
    }

    const regulation = await db.regulation.update({
      where: { id },
      data: {
        ...validated,
        version: { increment: 1 },
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Regulation",
        entityId: id,
        action: "UPDATE",
        oldValues: existingRegulation,
        newValues: regulation,
        changes: {
          updatedFields: Object.keys(validated),
          versionChange: existingRegulation.version + 1,
        },
      },
    });

    // Invalidate cache
    cache.invalidateRegulation(tenantId, id);

    return NextResponse.json({ success: true, data: regulation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating regulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update regulation" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/regulations/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const regulation = await db.regulation.findFirst({
      where: { id, tenantId },
    });

    if (!regulation) {
      return NextResponse.json(
        { success: false, error: "Regulation not found" },
        { status: 404 }
      );
    }

    // Soft delete
    await db.regulation.update({
      where: { id },
      data: { isActive: false },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Regulation",
        entityId: id,
        action: "DELETE",
        oldValues: regulation,
      },
    });

    // Invalidate cache
    cache.invalidateRegulation(tenantId, id);

    return NextResponse.json({ success: true, message: "Regulation deactivated" });
  } catch (error) {
    console.error("Error deleting regulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete regulation" },
      { status: 500 }
    );
  }
}
