import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PropagationEngine, propagateImpact } from "@/lib/propagation";
import { cache, CacheKeys } from "@/lib/cache";
import { z } from "zod";
import type { EntityType } from "@prisma/client";

const propagationRequestSchema = z.object({
  sourceType: z.enum(["DEPARTMENT", "BUDGET", "SERVICE", "KPI", "REGULATION"]),
  sourceId: z.string().min(1),
  initialImpact: z.number().min(0).max(1).optional(),
  maxDepth: z.number().min(1).max(20).optional(),
  impactThreshold: z.number().min(0).max(1).optional(),
  includeIndirect: z.boolean().optional(),
});

// POST /api/tenants/[tenantId]/propagation - Run propagation analysis
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = propagationRequestSchema.parse(body);

    // Verify tenant exists
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    // Check cache for existing propagation result
    const cacheKey = `propagation:${validated.sourceType}:${validated.sourceId}`;
    const cached = cache.get(tenantId, cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    // Run propagation
    const result = await propagateImpact({
      tenantId,
      sourceType: validated.sourceType as EntityType,
      sourceId: validated.sourceId,
      initialImpact: validated.initialImpact ?? 1.0,
      maxDepth: validated.maxDepth ?? 10,
      impactThreshold: validated.impactThreshold ?? 0.01,
      includeIndirect: validated.includeIndirect ?? true,
    });

    // Cache the result
    cache.set(tenantId, cacheKey, result, {
      ttl: 10 * 60 * 1000, // 10 minutes
      tags: ["propagation", `entity:${validated.sourceType}:${validated.sourceId}`],
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: validated.sourceType,
        entityId: validated.sourceId,
        action: "PROPAGATE",
        metadata: {
          maxDepth: validated.maxDepth ?? 10,
          totalAffected: result.totalAffected,
          executionTime: result.executionTime,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        sourceId: result.sourceId,
        sourceType: result.sourceType,
        totalAffected: result.totalAffected,
        maxDepth: result.maxDepth,
        executionTime: result.executionTime,
        affectedEntities: Array.from(result.nodes.values())
          .filter((n) => !(n.type === validated.sourceType && n.id === validated.sourceId))
          .sort((a, b) => b.impactScore - a.impactScore)
          .slice(0, 200),
        edges: result.edges,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error running propagation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to run propagation analysis" },
      { status: 500 }
    );
  }
}

// GET /api/tenants/[tenantId]/propagation - Get propagation status/info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Get edge statistics
    const edgeStats = await db.impactEdge.groupBy({
      by: ["sourceType"],
      where: { tenantId, isActive: true },
      _count: { id: true },
    });

    const targetStats = await db.impactEdge.groupBy({
      by: ["targetType"],
      where: { tenantId, isActive: true },
      _count: { id: true },
    });

    // Get cache statistics
    const cacheStats = cache.getStats();

    return NextResponse.json({
      success: true,
      data: {
        edgesBySourceType: edgeStats.map((s) => ({
          type: s.sourceType,
          count: s._count.id,
        })),
        edgesByTargetType: targetStats.map((s) => ({
          type: s.targetType,
          count: s._count.id,
        })),
        cache: cacheStats,
      },
    });
  } catch (error) {
    console.error("Error fetching propagation info:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch propagation info" },
      { status: 500 }
    );
  }
}
