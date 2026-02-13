import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

// Validation schema for tenant creation
const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(2).max(10).regex(/^[A-Z0-9_]+$/),
  settings: z.record(z.unknown()).optional(),
});

// GET /api/tenants - List all tenants
export async function GET() {
  try {
    const tenants = await db.tenant.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            departments: true,
            regulations: true,
            services: true,
            kpis: true,
            budgets: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: tenants.map((t) => ({
        ...t,
        counts: t._count,
        _count: undefined,
      })),
    });
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

// POST /api/tenants - Create a new tenant
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = createTenantSchema.parse(body);

    // Check if code already exists
    const existing = await db.tenant.findUnique({
      where: { code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Tenant code already exists" },
        { status: 400 }
      );
    }

    const tenant = await db.tenant.create({
      data: {
        name: validated.name,
        code: validated.code,
        settings: validated.settings ?? {},
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId: tenant.id,
        entityType: "Tenant",
        entityId: tenant.id,
        action: "CREATE",
        newValues: tenant,
      },
    });

    return NextResponse.json({ success: true, data: tenant }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating tenant:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create tenant" },
      { status: 500 }
    );
  }
}
