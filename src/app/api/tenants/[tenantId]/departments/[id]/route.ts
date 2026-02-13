import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/departments/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const department = await db.department.findFirst({
      where: { id, tenantId },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
        children: {
          where: { isActive: true },
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { regulations: true },
        },
      },
    });

    if (!department) {
      return NextResponse.json(
        { success: false, error: "Department not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...department,
        regulationCount: department._count.regulations,
        _count: undefined,
      },
    });
  } catch (error) {
    console.error("Error fetching department:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch department" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/departments/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateDepartmentSchema.parse(body);

    const existing = await db.department.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Department not found" },
        { status: 404 }
      );
    }

    // Prevent circular parent references
    if (validated.parentId === id) {
      return NextResponse.json(
        { success: false, error: "Department cannot be its own parent" },
        { status: 400 }
      );
    }

    const department = await db.department.update({
      where: { id },
      data: validated,
      include: {
        parent: { select: { id: true, name: true, code: true } },
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Department",
        entityId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: department,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: department });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating department:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update department" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/departments/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const department = await db.department.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { children: true } },
      },
    });

    if (!department) {
      return NextResponse.json(
        { success: false, error: "Department not found" },
        { status: 404 }
      );
    }

    if (department._count.children > 0) {
      return NextResponse.json(
        { success: false, error: "Cannot delete department with children" },
        { status: 400 }
      );
    }

    await db.department.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Department",
        entityId: id,
        action: "DELETE",
        oldValues: department,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, message: "Department deactivated" });
  } catch (error) {
    console.error("Error deleting department:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete department" },
      { status: 500 }
    );
  }
}
