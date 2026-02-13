import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const updateBudgetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  departmentId: z.string().optional().nullable(),
  amount: z.number().positive().optional(),
  currency: z.string().optional(),
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/budgets/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const budget = await db.budget.findFirst({
      where: { id, tenantId },
    });

    if (!budget) {
      return NextResponse.json(
        { success: false, error: "Budget not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: budget });
  } catch (error) {
    console.error("Error fetching budget:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch budget" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/budgets/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;
    const body = await request.json();
    const validated = updateBudgetSchema.parse(body);

    const existing = await db.budget.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Budget not found" },
        { status: 404 }
      );
    }

    const budget = await db.budget.update({
      where: { id },
      data: validated,
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Budget",
        entityId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: budget,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: budget });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error updating budget:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update budget" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/budgets/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; id: string }> }
) {
  try {
    const { tenantId, id } = await params;

    const budget = await db.budget.findFirst({
      where: { id, tenantId },
    });

    if (!budget) {
      return NextResponse.json(
        { success: false, error: "Budget not found" },
        { status: 404 }
      );
    }

    await db.budget.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Budget",
        entityId: id,
        action: "DELETE",
        oldValues: budget,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, message: "Budget deactivated" });
  } catch (error) {
    console.error("Error deleting budget:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete budget" },
      { status: 500 }
    );
  }
}
