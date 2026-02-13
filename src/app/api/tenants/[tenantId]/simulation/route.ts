import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TimelineSimulationEngine, SimulationComparison } from "@/lib/propagation";
import { cache, CacheKeys } from "@/lib/cache";
import { z } from "zod";

const createSimulationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  regulationId: z.string().optional(),
  simulationType: z.enum(["WhatIf", "Timeline", "Comparison"]).default("WhatIf"),
  baselineDate: z.string().transform((v) => new Date(v)),
  targetDate: z.string().transform((v) => new Date(v)).optional(),
  parameters: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/simulation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "20");

    const simulations = await db.simulation.findMany({
      where: {
        tenantId,
        ...(status && { status }),
      },
      include: {
        regulation: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ success: true, data: simulations });
  } catch (error) {
    console.error("Error fetching simulations:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch simulations" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/simulation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createSimulationSchema.parse(body);

    // Create simulation record
    const simulation = await db.simulation.create({
      data: {
        tenantId,
        name: validated.name,
        description: validated.description,
        regulationId: validated.regulationId,
        simulationType: validated.simulationType,
        baselineDate: validated.baselineDate,
        targetDate: validated.targetDate ?? new Date(),
        parameters: validated.parameters ?? {},
        status: "Pending",
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Simulation",
        entityId: simulation.id,
        action: "CREATE",
        newValues: simulation,
      },
    });

    // Run simulation asynchronously
    runSimulation(tenantId, simulation.id, validated).catch((error) => {
      console.error("Simulation error:", error);
    });

    return NextResponse.json(
      {
        success: true,
        data: simulation,
        message: "Simulation started",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating simulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create simulation" },
      { status: 500 }
    );
  }
}

// Run simulation in background
async function runSimulation(
  tenantId: string,
  simulationId: string,
  params: z.infer<typeof createSimulationSchema>
): Promise<void> {
  try {
    // Update status to Running
    await db.simulation.update({
      where: { id: simulationId },
      data: { status: "Running" },
    });

    let results: Record<string, unknown>;

    if (params.simulationType === "Comparison" && params.regulationId) {
      // Run timeline comparison
      const engine = new TimelineSimulationEngine(tenantId);
      const comparison = await engine.compareImpact(
        params.regulationId,
        params.baselineDate,
        params.targetDate ?? new Date()
      );
      results = {
        deltas: comparison.deltas,
        beforeState: {
          regulationCount: comparison.beforeState.regulationCount,
          impactedEntityCount: comparison.beforeState.entityImpacts.size,
        },
        afterState: {
          regulationCount: comparison.afterState.regulationCount,
          impactedEntityCount: comparison.afterState.entityImpacts.size,
        },
      };
    } else {
      // What-if analysis
      const regulation = params.regulationId
        ? await db.regulation.findUnique({ where: { id: params.regulationId } })
        : null;

      const weight = (params.parameters?.weight as number) ?? 1.0;
      const severity = (params.parameters?.severity as string) ?? "Medium";

      results = {
        type: "WhatIf",
        assumptions: {
          weight,
          severity,
          baselineDate: params.baselineDate,
          targetDate: params.targetDate,
        },
        regulation: regulation
          ? { id: regulation.id, name: regulation.name, code: regulation.code }
          : null,
      };
    }

    // Update with results
    await db.simulation.update({
      where: { id: simulationId },
      data: {
        status: "Completed",
        results,
        completedAt: new Date(),
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Simulation",
        entityId: simulationId,
        action: "SIMULATE",
        metadata: { status: "Completed", resultsSize: JSON.stringify(results).length },
      },
    });
  } catch (error) {
    console.error("Simulation failed:", error);

    await db.simulation.update({
      where: { id: simulationId },
      data: {
        status: "Failed",
        results: { error: error instanceof Error ? error.message : "Unknown error" },
      },
    });
  }
}
