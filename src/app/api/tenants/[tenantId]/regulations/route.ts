import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheKeys, CacheTags } from "@/lib/cache";

// Validation schema for regulation creation
const createRegulationSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  description: z.string().optional(),
  departmentId: z.string().optional(),
  regulationType: z.enum(["Compliance", "Policy", "Standard", "Law"]).optional(),
  effectiveDate: z.string().transform((v) => new Date(v)),
  expirationDate: z.string().transform((v) => new Date(v)).optional().nullable(),
  status: z.enum(["Draft", "Active", "Superseded", "Revoked"]).default("Draft"),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
  enforcementParams: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  parentRegulationId: z.string().optional(),
});

// GET /api/tenants/[tenantId]/regulations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");
    const departmentId = searchParams.get("departmentId");
    const search = searchParams.get("search");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where = {
      tenantId,
      isActive: true,
      ...(status && { status }),
      ...(severity && { severity }),
      ...(departmentId && { departmentId }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { code: { contains: search } },
          { description: { contains: search } },
        ],
      }),
    };

    const [regulations, total] = await Promise.all([
      db.regulation.findMany({
        where,
        include: {
          department: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { impacts: true },
          },
        },
        orderBy: { effectiveDate: "desc" },
        take: limit,
        skip: offset,
      }),
      db.regulation.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: regulations.map((r) => ({
        ...r,
        impactCount: r._count.impacts,
        _count: undefined,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error("Error fetching regulations:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch regulations" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/regulations
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createRegulationSchema.parse(body);

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

    // Check if code already exists for this tenant
    const existing = await db.regulation.findFirst({
      where: { tenantId, code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Regulation code already exists for this tenant" },
        { status: 400 }
      );
    }

    const regulation = await db.regulation.create({
      data: {
        tenantId,
        name: validated.name,
        code: validated.code,
        description: validated.description,
        departmentId: validated.departmentId,
        regulationType: validated.regulationType,
        effectiveDate: validated.effectiveDate,
        expirationDate: validated.expirationDate,
        status: validated.status,
        severity: validated.severity,
        enforcementParams: validated.enforcementParams ?? {},
        metadata: validated.metadata ?? {},
        parentRegulationId: validated.parentRegulationId,
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Regulation",
        entityId: regulation.id,
        action: "CREATE",
        newValues: regulation,
      },
    });

    // Invalidate relevant cache
    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: regulation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating regulation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create regulation" },
      { status: 500 }
    );
  }
}
