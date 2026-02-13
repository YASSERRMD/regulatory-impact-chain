import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDependencyGraph } from "@/lib/propagation";
import { cache, CacheKeys, CacheTags } from "@/lib/cache";

// GET /api/tenants/[tenantId]/graph - Get dependency graph for visualization
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get("format") || "full"; // full, nodes, edges, d3
    const refresh = searchParams.get("refresh") === "true";

    // Check cache
    const cacheKey = `graph:${format}`;
    if (!refresh) {
      const cached = cache.get(tenantId, cacheKey);
      if (cached) {
        return NextResponse.json({
          success: true,
          data: cached,
          cached: true,
        });
      }
    }

    // Build dependency graph
    const graph = await buildDependencyGraph(tenantId);

    // Fetch all entities for node enrichment
    const [departments, budgets, services, kpis, regulations] = await Promise.all([
      db.department.findMany({ where: { tenantId, isActive: true } }),
      db.budget.findMany({ where: { tenantId, isActive: true } }),
      db.service.findMany({ where: { tenantId, isActive: true } }),
      db.kPI.findMany({ where: { tenantId, isActive: true } }),
      db.regulation.findMany({ where: { tenantId, isActive: true } }),
    ]);

    // Create entity lookup maps
    const entityMap = new Map<string, { id: string; name: string; type: string }>();
    
    departments.forEach((d) => entityMap.set(`DEPARTMENT:${d.id}`, { id: d.id, name: d.name, type: "DEPARTMENT" }));
    budgets.forEach((b) => entityMap.set(`BUDGET:${b.id}`, { id: b.id, name: b.name, type: "BUDGET" }));
    services.forEach((s) => entityMap.set(`SERVICE:${s.id}`, { id: s.id, name: s.name, type: "SERVICE" }));
    kpis.forEach((k) => entityMap.set(`KPI:${k.id}`, { id: k.id, name: k.name, type: "KPI" }));
    regulations.forEach((r) => entityMap.set(`REGULATION:${r.id}`, { id: r.id, name: r.name, type: "REGULATION" }));

    // Build nodes array
    const nodes = Array.from(entityMap.values()).map((entity) => ({
      id: entity.id,
      label: entity.name,
      type: entity.type,
      key: `${entity.type}:${entity.id}`,
    }));

    // Build edges array for visualization
    const edges = graph.allEdges.map((edge) => ({
      id: edge.id,
      source: `${edge.sourceType}:${edge.sourceId}`,
      target: `${edge.targetType}:${edge.targetId}`,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceType: edge.sourceType,
      targetType: edge.targetType,
      weight: edge.impactWeight,
      impactType: edge.impactType,
      category: edge.impactCategory,
    }));

    let result: Record<string, unknown>;

    switch (format) {
      case "nodes":
        result = { nodes };
        break;
      case "edges":
        result = { edges };
        break;
      case "d3":
        // Format for D3.js force-directed graph
        result = {
          nodes: nodes.map((n) => ({
            id: n.key,
            label: n.label,
            group: n.type,
          })),
          links: edges.map((e) => ({
            source: e.source,
            target: e.target,
            value: e.weight,
          })),
        };
        break;
      case "cytoscape":
        // Format for Cytoscape.js
        result = {
          elements: {
            nodes: nodes.map((n) => ({
              data: { id: n.key, label: n.label, type: n.type },
            })),
            edges: edges.map((e) => ({
              data: {
                id: e.id,
                source: e.source,
                target: e.target,
                weight: e.weight,
              },
            })),
          },
        };
        break;
      case "full":
      default:
        result = {
          nodes,
          edges,
          stats: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            byType: {
              departments: departments.length,
              budgets: budgets.length,
              services: services.length,
              kpis: kpis.length,
              regulations: regulations.length,
            },
          },
        };
    }

    // Cache the result
    cache.set(tenantId, cacheKey, result, {
      ttl: 30 * 60 * 1000, // 30 minutes
      tags: [CacheTags.dependencyGraph],
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching graph:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch dependency graph" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/graph - Invalidate graph cache
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    cache.invalidateByTag(CacheTags.dependencyGraph);

    return NextResponse.json({
      success: true,
      message: "Graph cache invalidated",
    });
  } catch (error) {
    console.error("Error invalidating graph:", error);
    return NextResponse.json(
      { success: false, error: "Failed to invalidate graph cache" },
      { status: 500 }
    );
  }
}
