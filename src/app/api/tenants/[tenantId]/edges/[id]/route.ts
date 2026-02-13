import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const updateEdgeSchema = z.object({
  impactWeight: z.number().min(0).max(1).optional(),
  impactType: z.enum(["Direct", "Indirect", "Conditional"]).optional(),
  impactCategory: z.string().optional(),
  description: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/edges/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const edge = await db.impactEdge.findFirst({
      where: { id, tenantId },
    });

    if (!edge) {
      return NextResponse.json(
        { success: false, error: "Impact edge not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: edge });
  } catch (error) {
    console.error("Error fetching edge:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch impact edge" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/edges/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateEdgeSchema.parse(body);

    const existing = await db.impactEdge.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Impact edge not found" },
        { status: 404 }
      );
    }

    const edge = await db.impactEdge.update({
      where: { id },
      data: validated,
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "ImpactEdge",
        entityId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: edge,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: edge });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating edge:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update impact edge" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/edges/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const edge = await db.impactEdge.findFirst({
      where: { id, tenantId },
    });

    if (!edge) {
      return NextResponse.json(
        { success: false, error: "Impact edge not found" },
        { status: 404 }
      );
    }

    await db.impactEdge.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "ImpactEdge",
        entityId: id,
        action: "DELETE",
        oldValues: edge,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, message: "Impact edge deactivated" });
  } catch (error) {
    console.error("Error deleting edge:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete impact edge" },
      { status: 500 }
    );
  }
}
