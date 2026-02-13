import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RiskIndexCalculator, RiskCalculationResult, DepartmentRiskRanking } from "@/lib/propagation";
import { cache, CacheKeys, CacheTags } from "@/lib/cache";
import { z } from "zod";
import type { EntityType } from "@prisma/client";

// GET /api/tenants/[tenantId]/risks - Get risk scores and rankings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");
    const includeRankings = searchParams.get("rankings") === "true";
    const refresh = searchParams.get("refresh") === "true";

    // Check cache first
    if (!refresh) {
      const cachedRanking = cache.get<DepartmentRiskRanking[]>(tenantId, CacheKeys.riskRanking(tenantId));
      if (cachedRanking && includeRankings) {
        return NextResponse.json({
          success: true,
          data: { rankings: cachedRanking },
          cached: true,
        });
      }
    }

    const calculator = new RiskIndexCalculator(tenantId);

    if (entityType && entityId) {
      // Get specific entity risk
      const risks = await calculator.calculateAllRisks();
      const entityRisk = risks.find(
        (r) => r.entityType === entityType && r.entityId === entityId
      );

      if (!entityRisk) {
        return NextResponse.json({
          success: true,
          data: { risk: null, message: "No risk score calculated for this entity" },
        });
      }

      return NextResponse.json({ success: true, data: { risk: entityRisk } });
    }

    // Get all risks
    const risks = await calculator.calculateAllRisks();
    const rankings = includeRankings ? await calculator.getDepartmentRiskRanking() : [];

    // Cache results
    if (includeRankings) {
      cache.set(tenantId, CacheKeys.riskRanking(tenantId), rankings, {
        ttl: 15 * 60 * 1000, // 15 minutes
        tags: [CacheTags.riskScores],
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        risks: risks.slice(0, 100), // Limit response size
        rankings,
        summary: {
          totalEntities: risks.length,
          criticalCount: risks.filter((r) => r.riskLevel === "Critical").length,
          highCount: risks.filter((r) => r.riskLevel === "High").length,
          mediumCount: risks.filter((r) => r.riskLevel === "Medium").length,
          lowCount: risks.filter((r) => r.riskLevel === "Low").length,
        },
      },
    });
  } catch (error) {
    console.error("Error calculating risks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to calculate risk scores" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/risks - Trigger risk recalculation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Invalidate cache
    cache.invalidateByTag(CacheTags.riskScores);

    const calculator = new RiskIndexCalculator(tenantId);
    const risks = await calculator.calculateAllRisks();
    const rankings = await calculator.getDepartmentRiskRanking();

    // Store risk scores in database
    for (const risk of risks) {
      await db.riskScore.upsert({
        where: {
          tenantId_entityType_entityId_regulationId: {
            tenantId,
            entityType: risk.entityType as EntityType,
            entityId: risk.entityId,
            regulationId: null,
          },
        },
        update: {
          baseRiskScore: risk.baseRiskScore,
          adjustedRiskScore: risk.adjustedRiskScore,
          riskLevel: risk.riskLevel,
          riskFactors: risk.riskFactors,
          calculatedAt: new Date(),
        },
        create: {
          tenantId,
          entityType: risk.entityType as EntityType,
          entityId: risk.entityId,
          baseRiskScore: risk.baseRiskScore,
          adjustedRiskScore: risk.adjustedRiskScore,
          riskLevel: risk.riskLevel,
          riskFactors: risk.riskFactors,
        },
      });
    }

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "RiskScore",
        action: "RECALCULATE",
        metadata: {
          entityCount: risks.length,
          criticalCount: risks.filter((r) => r.riskLevel === "Critical").length,
          highCount: risks.filter((r) => r.riskLevel === "High").length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        risks: risks.slice(0, 100),
        rankings,
        summary: {
          totalEntities: risks.length,
          criticalCount: risks.filter((r) => r.riskLevel === "Critical").length,
          highCount: risks.filter((r) => r.riskLevel === "High").length,
          mediumCount: risks.filter((r) => r.riskLevel === "Medium").length,
          lowCount: risks.filter((r) => r.riskLevel === "Low").length,
        },
      },
      socketEvent: {
        type: "RISK_UPDATE",
        tenantId,
        summary: {
          totalEntities: risks.length,
          criticalCount: risks.filter((r) => r.riskLevel === "Critical").length,
        },
      },
    });
  } catch (error) {
    console.error("Error recalculating risks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to recalculate risk scores" },
      { status: 500 }
    );
  }
}
