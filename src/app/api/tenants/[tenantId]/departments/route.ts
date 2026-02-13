import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache, CacheTags } from "@/lib/cache";

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  description: z.string().optional(),
  parentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/tenants/[tenantId]/departments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search");
    const includeHierarchy = searchParams.get("hierarchy") === "true";

    const departments = await db.department.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(search && {
          OR: [
            { name: { contains: search } },
            { code: { contains: search } },
          ],
        }),
      },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { children: true, regulations: true },
        },
      },
      orderBy: { name: "asc" },
    });

    if (includeHierarchy) {
      // Build hierarchical structure
      const deptMap = new Map(departments.map((d) => [d.id, { ...d, children: [] as typeof departments }]));

      departments.forEach((dept) => {
        if (dept.parentId && deptMap.has(dept.parentId)) {
          deptMap.get(dept.parentId)!.children.push(deptMap.get(dept.id)!);
        }
      });

      // Return only root departments with nested children
      const hierarchy = departments
        .filter((d) => !d.parentId)
        .map((d) => deptMap.get(d.id));

      return NextResponse.json({
        success: true,
        data: hierarchy,
        flat: departments,
      });
    }

    return NextResponse.json({
      success: true,
      data: departments.map((d) => ({
        ...d,
        childCount: d._count.children,
        regulationCount: d._count.regulations,
        _count: undefined,
      })),
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch departments" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/departments
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const validated = createDepartmentSchema.parse(body);

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

    // Check for duplicate code
    const existing = await db.department.findFirst({
      where: { tenantId, code: validated.code },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Department code already exists" },
        { status: 400 }
      );
    }

    const department = await db.department.create({
      data: {
        tenantId,
        name: validated.name,
        code: validated.code,
        description: validated.description,
        parentId: validated.parentId,
        metadata: validated.metadata ?? {},
      },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        tenantId,
        entityType: "Department",
        entityId: department.id,
        action: "CREATE",
        newValues: department,
      },
    });

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({ success: true, data: department }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Error creating department:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create department" },
      { status: 500 }
    );
  }
}
