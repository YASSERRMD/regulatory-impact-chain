import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const createKPISchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  departmentId: z.string().optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  measurementFrequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly"]).default("Monthly"),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/kpis
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const departmentId = searchParams.get("departmentId");

    const kpis = await db.kPI.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(departmentId && { departmentId }),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ success: true, data: kpis });
  } catch (error) {
    console.error("Error fetching KPIs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch KPIs" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/kpis
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createKPISchema.parse(body);

    const existing = await db.kPI.findFirst({
      where: { tenantId, code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "KPI code already exists" },
        { status: 400 }
      );
    }

    const kpi = await db.kPI.create({
      data: {
        tenantId,
        ...validated,
        metadata: validated.metadata ?? {},
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "KPI",
        entityId: kpi.id,
        action: "CREATE",
        newValues: kpi,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: kpi }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating KPI:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create KPI" },
      { status: 500 }
    );
  }
}
