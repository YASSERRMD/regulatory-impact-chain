import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";
import { EntityType } from "@prisma/client";

const createEdgeSchema = z.object({
  sourceType: z.enum(["DEPARTMENT", "BUDGET", "SERVICE", "KPI", "REGULATION"]),
  sourceId: z.string().min(1),
  targetType: z.enum(["DEPARTMENT", "BUDGET", "SERVICE", "KPI", "REGULATION"]),
  targetId: z.string().min(1),
  impactWeight: z.number().min(0).max(1).default(1.0),
  impactType: z.enum(["Direct", "Indirect", "Conditional"]).default("Direct"),
  impactCategory: z.string().optional(),
  description: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/edges
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const sourceType = searchParams.get("sourceType") as EntityType | null;
    const sourceId = searchParams.get("sourceId");
    const targetType = searchParams.get("targetType") as EntityType | null;
    const targetId = searchParams.get("targetId");

    const edges = await db.impactEdge.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(sourceType && { sourceType }),
        ...(sourceId && { sourceId }),
        ...(targetType && { targetType }),
        ...(targetId && { targetId }),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: edges });
  } catch (error) {
    console.error("Error fetching edges:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch impact edges" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/edges
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createEdgeSchema.parse(body);

    // Prevent self-referential edges
    if (validated.sourceType === validated.targetType && validated.sourceId === validated.targetId) {
      return NextResponse.json(
        { success: false, error: "Cannot create self-referential edge" },
        { status: 400 }
      );
    }

    // Check for duplicate edge
    const existing = await db.impactEdge.findFirst({
      where: {
        tenantId,
        sourceType: validated.sourceType,
        sourceId: validated.sourceId,
        targetType: validated.targetType,
        targetId: validated.targetId,
      },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Edge already exists between these entities" },
        { status: 400 }
      );
    }

    const edge = await db.impactEdge.create({
      data: {
        tenantId,
        sourceType: validated.sourceType,
        sourceId: validated.sourceId,
        targetType: validated.targetType,
        targetId: validated.targetId,
        impactWeight: validated.impactWeight,
        impactType: validated.impactType,
        impactCategory: validated.impactCategory,
        description: validated.description,
        conditions: validated.conditions ?? {},
        metadata: validated.metadata ?? {},
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "ImpactEdge",
        entityId: edge.id,
        action: "CREATE",
        newValues: edge,
      },
    });

    // Invalidate dependency graph cache
    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: edge }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating edge:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create impact edge" },
      { status: 500 }
    );
  }
}
