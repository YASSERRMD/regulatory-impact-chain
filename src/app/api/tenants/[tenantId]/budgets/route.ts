import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const createBudgetSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  departmentId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  fiscalYear: z.number().int().min(2000).max(2100),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/budgets
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const fiscalYear = searchParams.get("fiscalYear");
    const departmentId = searchParams.get("departmentId");

    const budgets = await db.budget.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(fiscalYear && { fiscalYear: parseInt(fiscalYear) }),
        ...(departmentId && { departmentId }),
      },
      orderBy: [{ fiscalYear: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, data: budgets });
  } catch (error) {
    console.error("Error fetching budgets:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch budgets" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/budgets
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createBudgetSchema.parse(body);

    const existing = await db.budget.findFirst({
      where: { tenantId, code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Budget code already exists" },
        { status: 400 }
      );
    }

    const budget = await db.budget.create({
      data: {
        tenantId,
        ...validated,
        metadata: validated.metadata ?? {},
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Budget",
        entityId: budget.id,
        action: "CREATE",
        newValues: budget,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: budget }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating budget:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create budget" },
      { status: 500 }
    );
  }
}
