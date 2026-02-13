import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

// Validation schema for tenant update
const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settings: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/tenants/[tenantId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            departments: true,
            regulations: true,
            services: true,
            kpis: true,
            budgets: true,
            impactEdges: true,
          },
        },
      },
    });

    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...tenant,
        counts: tenant._count,
        _count: undefined,
      },
    });
  } catch (error) {
    console.error("Error fetching tenant:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch tenant" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = updateTenantSchema.parse(body);

    const existingTenant = await db.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!existingTenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const tenant = await db.tenant.update({
      where: { id: tenantId },
      data: validated,
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Tenant",
        entityId: tenantId,
        action: "UPDATE",
        oldValues: existingTenant,
        newValues: tenant,
      },
    });

    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating tenant:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update tenant" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    // Soft delete by setting isActive to false
    await db.tenant.update({
      where: { id: tenantId },
      data: { isActive: false },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Tenant",
        entityId: tenantId,
        action: "DELETE",
        oldValues: tenant,
      },
    });

    return NextResponse.json({ success: true, message: "Tenant deactivated" });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete tenant" },
      { status: 500 }
    );
  }
}
