import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PropagationEngine, PropagationResult } from "@/lib/propagation";
import { cache, CacheTags } from "@/lib/cache";
import type { EntityType } from "@prisma/client";

// POST /api/tenants/[tenantId]/regulations/[id]/propagate
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json().catch(() => ({}));

    const maxDepth = body.maxDepth ?? 10;
    const impactThreshold = body.impactThreshold ?? 0.01;

    // Verify regulation exists
    const regulation = await db.regulation.findFirst({
      where: { id, tenantId, isActive: true },
    });

    if (!regulation) {
      return NextResponse.json(
        { success: false, error: "Regulation not found or inactive" },
        { status: 404 }
      );
    }

    // Create audit log for propagation start
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Regulation",
        entityId: id,
        action: "PROPAGATE",
        metadata: {
          maxDepth,
          impactThreshold,
          status: "started",
        },
      },
    });

    // Initialize propagation engine
    const engine = new PropagationEngine(tenantId, {
      maxDepth,
      impactThreshold,
      includeIndirect: true,
    });

    // Run propagation
    const result = await engine.propagate({
      tenantId,
      sourceType: "REGULATION" as EntityType,
      sourceId: id,
      initialImpact: getInitialImpactFromSeverity(regulation.severity),
      maxDepth,
      impactThreshold,
    });

    // Store impacts in database
    const impactRecords = [];
    for (const [key, node] of result.nodes) {
      if (key.startsWith("REGULATION:")) continue; // Skip source

      const [type, entityId] = key.split(":") as [EntityType, string];
      impactRecords.push({
        regulationId: id,
        targetType: type,
        targetId: entityId,
        impactScore: node.impactScore,
        impactLevel: PropagationEngine.getRiskLevel(node.impactScore),
        impactPath: node.path,
        propagatedAt: new Date(),
      });
    }

    // Clear existing impacts and insert new ones
    await db.regulationImpact.deleteMany({
      where: { regulationId: id },
    });

    if (impactRecords.length > 0) {
      await db.regulationImpact.createMany({
        data: impactRecords,
      });
    }

    // Invalidate cache
    cache.invalidateByTag(CacheTags.dependencyGraph);
    cache.invalidateByTag(CacheTags.impactAnalysis);
    cache.invalidateByTag(CacheTags.riskScores);

    // Create audit log for propagation complete
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Regulation",
        entityId: id,
        action: "PROPAGATE",
        metadata: {
          maxDepth,
          impactThreshold,
          status: "completed",
          affectedEntities: result.totalAffected,
          executionTime: result.executionTime,
        },
      },
    });

    // Return result with Socket.io notification info
    return NextResponse.json({
      success: true,
      data: {
        regulationId: id,
        totalAffected: result.totalAffected,
        maxDepth: result.maxDepth,
        executionTime: result.executionTime,
        impacts: Array.from(result.nodes.values())
          .filter((n) => n.type !== "REGULATION")
          .sort((a, b) => b.impactScore - a.impactScore)
          .slice(0, 100), // Limit response size
        socketEvent: {
          type: "RECALCULATION_COMPLETE",
          tenantId,
          regulationId: id,
          affectedEntities: Array.from(result.nodes.values())
            .filter((n) => n.type !== "REGULATION")
            .map((n) => ({
              type: n.type,
              id: n.id,
              impactScore: n.impactScore,
            })),
        },
      },
    });
  } catch (error) {
    console.error("Error propagating regulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to propagate regulation impact" },
      { status: 500 }
    );
  }
}

// GET /api/tenants/[tenantId]/regulations/[id]/propagate - Get current impacts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const impacts = await db.regulationImpact.findMany({
      where: { regulationId: id },
      orderBy: { impactScore: "desc" },
      take: 100,
    });

    // Get entity details for each impact
    const enrichedImpacts = await Promise.all(
      impacts.map(async (impact) => {
        const entityInfo = await getEntityInfo(impact.targetType, impact.targetId);
        return {
          ...impact,
          entityName: entityInfo?.name ?? impact.targetId,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: enrichedImpacts,
    });
  } catch (error) {
    console.error("Error fetching impacts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch impacts" },
      { status: 500 }
    );
  }
}

function getInitialImpactFromSeverity(severity: string | null): number {
  switch (severity) {
    case "Critical":
      return 1.0;
    case "High":
      return 0.8;
    case "Medium":
      return 0.5;
    case "Low":
      return 0.3;
    default:
      return 0.5;
  }
}

async function getEntityInfo(
  entityType: EntityType,
  entityId: string
): Promise<{ name: string } | null> {
  try {
    switch (entityType) {
      case "DEPARTMENT": {
        return await db.department.findUnique({
          where: { id: entityId },
          select: { name: true },
        });
      }
      case "BUDGET": {
        return await db.budget.findUnique({
          where: { id: entityId },
          select: { name: true },
        });
      }
      case "SERVICE": {
        return await db.service.findUnique({
          where: { id: entityId },
          select: { name: true },
        });
      }
      case "KPI": {
        return await db.kPI.findUnique({
          where: { id: entityId },
          select: { name: true },
        });
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
