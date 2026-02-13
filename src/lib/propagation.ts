/**
 * Dependency Propagation Engine
 * Handles multi-layer weighted propagation with depth control
 */

import { db } from "@/lib/db";
import { cache, CacheKeys, CacheTags } from "@/lib/cache";
import type { EntityType, ImpactEdge, Regulation, Prisma } from "@prisma/client";

// Types for propagation
export interface PropagationNode {
  id: string;
  type: EntityType;
  name: string;
  impactScore: number;
  depth: number;
  path: PropagationPath[];
}

export interface PropagationPath {
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  weight: number;
  impactType: string;
}

export interface PropagationResult {
  sourceId: string;
  sourceType: EntityType;
  totalAffected: number;
  maxDepth: number;
  nodes: Map<string, PropagationNode>;
  edges: PropagationPath[];
  executionTime: number;
}

export interface PropagationConfig {
  tenantId: string;
  sourceType: EntityType;
  sourceId: string;
  initialImpact?: number;
  maxDepth?: number;
  impactThreshold?: number;
  includeIndirect?: boolean;
}

// Severity weights based on entity type
const SEVERITY_WEIGHTS: Record<string, number> = {
  DEPARTMENT: 1.0,
  BUDGET: 0.9,
  SERVICE: 0.8,
  KPI: 0.7,
  REGULATION: 1.2,
};

// Impact type multipliers
const IMPACT_TYPE_MULTIPLIERS: Record<string, number> = {
  Direct: 1.0,
  Indirect: 0.6,
  Conditional: 0.3,
};

// Risk level thresholds
const RISK_THRESHOLDS = {
  Low: 0.3,
  Medium: 0.5,
  High: 0.7,
  Critical: 0.9,
};

/**
 * Dependency Graph Builder
 * Builds and caches the dependency graph for a tenant
 */
export async function buildDependencyGraph(tenantId: string): Promise<DependencyGraph> {
  // Check cache first
  const cached = cache.get<DependencyGraph>(tenantId, CacheKeys.dependencyGraph(tenantId));
  if (cached) {
    return cached;
  }

  // Fetch all edges for the tenant
  const edges = await db.impactEdge.findMany({
    where: { tenantId, isActive: true },
  });

  // Build adjacency lists
  const graph: DependencyGraph = {
    outgoing: new Map(),
    incoming: new Map(),
    allEdges: edges,
  };

  edges.forEach((edge) => {
    // Outgoing edges (from source)
    const sourceKey = `${edge.sourceType}:${edge.sourceId}`;
    if (!graph.outgoing.has(sourceKey)) {
      graph.outgoing.set(sourceKey, []);
    }
    graph.outgoing.get(sourceKey)!.push(edge);

    // Incoming edges (to target)
    const targetKey = `${edge.targetType}:${edge.targetId}`;
    if (!graph.incoming.has(targetKey)) {
      graph.incoming.set(targetKey, []);
    }
    graph.incoming.get(targetKey)!.push(edge);
  });

  // Cache the graph
  cache.set(tenantId, CacheKeys.dependencyGraph(tenantId), graph, {
    ttl: 60 * 60 * 1000, // 1 hour
    tags: [CacheTags.dependencyGraph, tenantId],
  });

  return graph;
}

export interface DependencyGraph {
  outgoing: Map<string, ImpactEdge[]>;
  incoming: Map<string, ImpactEdge[]>;
  allEdges: ImpactEdge[];
}

/**
 * Propagation Engine Class
 */
export class PropagationEngine {
  private tenantId: string;
  private graph: DependencyGraph | null = null;
  private visited: Set<string>;
  private maxDepth: number;
  private impactThreshold: number;
  private includeIndirect: boolean;

  constructor(
    tenantId: string,
    options?: { maxDepth?: number; impactThreshold?: number; includeIndirect?: boolean }
  ) {
    this.tenantId = tenantId;
    this.visited = new Set();
    this.maxDepth = options?.maxDepth ?? 10;
    this.impactThreshold = options?.impactThreshold ?? 0.01;
    this.includeIndirect = options?.includeIndirect ?? true;
  }

  /**
   * Initialize the engine by loading the dependency graph
   */
  async initialize(): Promise<void> {
    this.graph = await buildDependencyGraph(this.tenantId);
  }

  /**
   * Propagate impact from a source entity
   */
  async propagate(config: PropagationConfig): Promise<PropagationResult> {
    const startTime = Date.now();

    if (!this.graph) {
      await this.initialize();
    }

    const { sourceType, sourceId, initialImpact = 1.0 } = config;
    const nodes = new Map<string, PropagationNode>();
    const edges: PropagationPath[] = [];
    this.visited.clear();

    // Add source node
    const sourceKey = `${sourceType}:${sourceId}`;
    const sourceNode = await this.getEntityInfo(sourceType, sourceId);
    
    nodes.set(sourceKey, {
      id: sourceId,
      type: sourceType,
      name: sourceNode?.name ?? sourceId,
      impactScore: initialImpact,
      depth: 0,
      path: [],
    });

    // BFS propagation
    await this.propagateBFS(
      sourceType,
      sourceId,
      initialImpact,
      0,
      nodes,
      edges
    );

    return {
      sourceId,
      sourceType,
      totalAffected: nodes.size - 1, // Exclude source
      maxDepth: Math.max(...Array.from(nodes.values()).map((n) => n.depth)),
      nodes,
      edges,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * BFS-based propagation algorithm
   */
  private async propagateBFS(
    currentType: EntityType,
    currentId: string,
    currentImpact: number,
    depth: number,
    nodes: Map<string, PropagationNode>,
    edges: PropagationPath[]
  ): Promise<void> {
    if (!this.graph) return;

    // Stop conditions
    if (depth >= this.maxDepth) return;
    if (currentImpact < this.impactThreshold) return;

    const currentKey = `${currentType}:${currentId}`;

    // Get outgoing edges
    const outgoingEdges = this.graph.outgoing.get(currentKey) ?? [];

    for (const edge of outgoingEdges) {
      // Skip inactive edges
      if (!edge.isActive) continue;

      // Skip indirect impacts if not included
      if (edge.impactType === "Indirect" && !this.includeIndirect) continue;

      // Check conditions if conditional impact
      if (edge.impactType === "Conditional" && edge.conditions) {
        const conditionsMet = this.evaluateConditions(edge.conditions as Record<string, unknown>);
        if (!conditionsMet) continue;
      }

      const targetKey = `${edge.targetType}:${edge.targetId}`;
      const visitedKey = `${currentKey}->${targetKey}`;

      // Prevent loops
      if (this.visited.has(visitedKey)) continue;
      this.visited.add(visitedKey);

      // Calculate propagated impact
      const impactMultiplier = IMPACT_TYPE_MULTIPLIERS[edge.impactType] ?? 1.0;
      const severityWeight = SEVERITY_WEIGHTS[edge.targetType] ?? 1.0;
      const propagatedImpact =
        currentImpact * edge.impactWeight * impactMultiplier * severityWeight;

      // Only process if impact is significant
      if (propagatedImpact < this.impactThreshold) continue;

      // Add edge to path
      const pathEntry: PropagationPath = {
        sourceType: currentType,
        sourceId: currentId,
        targetType: edge.targetType,
        targetId: edge.targetId,
        weight: edge.impactWeight,
        impactType: edge.impactType,
      };
      edges.push(pathEntry);

      // Update or add target node
      const existingNode = nodes.get(targetKey);
      const targetInfo = await this.getEntityInfo(edge.targetType, edge.targetId);

      if (existingNode) {
        // Accumulate impact from multiple paths
        existingNode.impactScore = Math.max(existingNode.impactScore, propagatedImpact);
        existingNode.path.push(pathEntry);
      } else {
        nodes.set(targetKey, {
          id: edge.targetId,
          type: edge.targetType,
          name: targetInfo?.name ?? edge.targetId,
          impactScore: propagatedImpact,
          depth: depth + 1,
          path: [pathEntry],
        });
      }

      // Continue propagation
      await this.propagateBFS(
        edge.targetType,
        edge.targetId,
        propagatedImpact,
        depth + 1,
        nodes,
        edges
      );
    }
  }

  /**
   * Evaluate conditional impact conditions
   */
  private evaluateConditions(conditions: Record<string, unknown>): boolean {
    // Simple condition evaluation - can be extended
    if (conditions.required) {
      return conditions.required === true;
    }
    if (conditions.threshold) {
      const threshold = conditions.threshold as number;
      return threshold > 0;
    }
    return true;
  }

  /**
   * Get entity information from database
   */
  private async getEntityInfo(
    entityType: EntityType,
    entityId: string
  ): Promise<{ name: string } | null> {
    try {
      switch (entityType) {
        case "DEPARTMENT": {
          const dept = await db.department.findUnique({
            where: { id: entityId },
            select: { name: true },
          });
          return dept;
        }
        case "BUDGET": {
          const budget = await db.budget.findUnique({
            where: { id: entityId },
            select: { name: true },
          });
          return budget;
        }
        case "SERVICE": {
          const service = await db.service.findUnique({
            where: { id: entityId },
            select: { name: true },
          });
          return service;
        }
        case "KPI": {
          const kpi = await db.kPI.findUnique({
            where: { id: entityId },
            select: { name: true },
          });
          return kpi;
        }
        case "REGULATION": {
          const regulation = await db.regulation.findUnique({
            where: { id: entityId },
            select: { name: true },
          });
          return regulation;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Calculate risk level from impact score
   */
  static getRiskLevel(impactScore: number): string {
    if (impactScore >= RISK_THRESHOLDS.Critical) return "Critical";
    if (impactScore >= RISK_THRESHOLDS.High) return "High";
    if (impactScore >= RISK_THRESHOLDS.Medium) return "Medium";
    return "Low";
  }

  /**
   * Get entities affected by a regulation
   */
  async getRegulationImpact(regulationId: string): Promise<PropagationResult | null> {
    const regulation = await db.regulation.findUnique({
      where: { id: regulationId },
    });

    if (!regulation) return null;

    return this.propagate({
      tenantId: this.tenantId,
      sourceType: "REGULATION",
      sourceId: regulationId,
      initialImpact: this.getInitialImpactFromSeverity(regulation.severity),
    });
  }

  /**
   * Convert severity to initial impact score
   */
  private getInitialImpactFromSeverity(severity: string | null): number {
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
}

/**
 * Timeline Simulation Engine
 */
export class TimelineSimulationEngine {
  private tenantId: string;
  private propagationEngine: PropagationEngine;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.propagationEngine = new PropagationEngine(tenantId);
  }

  /**
   * Run a before/after comparison simulation
   */
  async compareImpact(
    regulationId: string,
    beforeDate: Date,
    afterDate: Date
  ): Promise<SimulationComparison> {
    await this.propagationEngine.initialize();

    // Get regulation
    const regulation = await db.regulation.findUnique({
      where: { id: regulationId },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    // Calculate before state (without this regulation)
    const beforeState = await this.calculateStateBefore(regulation, beforeDate);

    // Calculate after state (with this regulation)
    const afterState = await this.calculateStateAfter(regulation, afterDate);

    // Calculate deltas
    const deltas = this.calculateDeltas(beforeState, afterState);

    return {
      regulationId,
      beforeDate,
      afterDate,
      beforeState,
      afterState,
      deltas,
    };
  }

  /**
   * Calculate state before regulation
   */
  private async calculateStateBefore(
    regulation: Regulation,
    date: Date
  ): Promise<SimulationState> {
    // Get all active regulations before this date
    const existingRegulations = await db.regulation.findMany({
      where: {
        tenantId: this.tenantId,
        effectiveDate: { lt: date },
        id: { not: regulation.id },
        status: "Active",
      },
    });

    // Aggregate impacts from existing regulations
    const aggregatedImpact = new Map<string, number>();

    for (const reg of existingRegulations) {
      const result = await this.propagationEngine.propagate({
        tenantId: this.tenantId,
        sourceType: "REGULATION",
        sourceId: reg.id,
        maxDepth: 5,
      });

      result.nodes.forEach((node, key) => {
        const existing = aggregatedImpact.get(key) ?? 0;
        aggregatedImpact.set(key, existing + node.impactScore * 0.5); // Weighted aggregation
      });
    }

    return {
      timestamp: date,
      entityImpacts: aggregatedImpact,
      regulationCount: existingRegulations.length,
    };
  }

  /**
   * Calculate state after regulation
   */
  private async calculateStateAfter(
    regulation: Regulation,
    date: Date
  ): Promise<SimulationState> {
    const result = await this.propagationEngine.propagate({
      tenantId: this.tenantId,
      sourceType: "REGULATION",
      sourceId: regulation.id,
      maxDepth: 5,
    });

    const entityImpacts = new Map<string, number>();
    result.nodes.forEach((node, key) => {
      entityImpacts.set(key, node.impactScore);
    });

    return {
      timestamp: date,
      entityImpacts,
      regulationCount: 1, // Just this regulation's impact
    };
  }

  /**
   * Calculate deltas between states
   */
  private calculateDeltas(
    before: SimulationState,
    after: SimulationState
  ): SimulationDelta[] {
    const deltas: SimulationDelta[] = [];
    const allKeys = new Set([...before.entityImpacts.keys(), ...after.entityImpacts.keys()]);

    allKeys.forEach((key) => {
      const beforeValue = before.entityImpacts.get(key) ?? 0;
      const afterValue = after.entityImpacts.get(key) ?? 0;
      const delta = afterValue - beforeValue;

      if (Math.abs(delta) > 0.01) {
        deltas.push({
          entityKey: key,
          beforeValue,
          afterValue,
          delta,
          percentChange: beforeValue !== 0 ? (delta / beforeValue) * 100 : 100,
        });
      }
    });

    return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
}

export interface SimulationState {
  timestamp: Date;
  entityImpacts: Map<string, number>;
  regulationCount: number;
}

export interface SimulationDelta {
  entityKey: string;
  beforeValue: number;
  afterValue: number;
  delta: number;
  percentChange: number;
}

export interface SimulationComparison {
  regulationId: string;
  beforeDate: Date;
  afterDate: Date;
  beforeState: SimulationState;
  afterState: SimulationState;
  deltas: SimulationDelta[];
}

/**
 * Risk Index Calculator
 */
export class RiskIndexCalculator {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Calculate risk scores for all entities
   */
  async calculateAllRisks(): Promise<RiskCalculationResult[]> {
    const results: RiskCalculationResult[] = [];

    // Get all active regulations
    const regulations = await db.regulation.findMany({
      where: {
        tenantId: this.tenantId,
        status: "Active",
      },
    });

    // Aggregate risk per entity
    const entityRisks = new Map<string, { totalRisk: number; factors: Map<string, number> }>();

    for (const regulation of regulations) {
      const engine = new PropagationEngine(this.tenantId);
      const result = await engine.propagate({
        tenantId: this.tenantId,
        sourceType: "REGULATION",
        sourceId: regulation.id,
        maxDepth: 10,
      });

      result.nodes.forEach((node, key) => {
        if (!entityRisks.has(key)) {
          entityRisks.set(key, { totalRisk: 0, factors: new Map() });
        }
        const entity = entityRisks.get(key)!;
        entity.totalRisk += node.impactScore * this.getSeverityMultiplier(regulation.severity);
        entity.factors.set(regulation.id, node.impactScore);
      });
    }

    // Convert to results
    entityRisks.forEach((data, key) => {
      const [type, id] = key.split(":") as [EntityType, string];
      const riskLevel = PropagationEngine.getRiskLevel(data.totalRisk / regulations.length);

      results.push({
        entityType: type,
        entityId: id,
        baseRiskScore: data.totalRisk / regulations.length,
        adjustedRiskScore: data.totalRisk,
        riskLevel,
        riskFactors: Object.fromEntries(data.factors),
      });
    });

    return results.sort((a, b) => b.adjustedRiskScore - a.adjustedRiskScore);
  }

  /**
   * Get severity multiplier for risk calculation
   */
  private getSeverityMultiplier(severity: string | null): number {
    switch (severity) {
      case "Critical":
        return 2.0;
      case "High":
        return 1.5;
      case "Medium":
        return 1.0;
      case "Low":
        return 0.5;
      default:
        return 1.0;
    }
  }

  /**
   * Get department risk ranking
   */
  async getDepartmentRiskRanking(): Promise<DepartmentRiskRanking[]> {
    const risks = await this.calculateAllRisks();
    
    // Group by department
    const departmentRisks = new Map<string, { totalRisk: number; count: number; entities: string[] }>();

    for (const risk of risks) {
      if (risk.entityType === "DEPARTMENT") {
        departmentRisks.set(risk.entityId, {
          totalRisk: risk.adjustedRiskScore,
          count: 1,
          entities: [risk.entityId],
        });
      }
    }

    // Add related entity risks to departments
    // (This would require looking up department relationships - simplified here)

    const rankings: DepartmentRiskRanking[] = [];
    for (const [deptId, data] of departmentRisks) {
      const dept = await db.department.findUnique({
        where: { id: deptId },
        select: { name: true, code: true },
      });

      rankings.push({
        departmentId: deptId,
        departmentName: dept?.name ?? deptId,
        departmentCode: dept?.code ?? deptId,
        riskScore: data.totalRisk,
        riskLevel: PropagationEngine.getRiskLevel(data.totalRisk),
        affectedEntityCount: data.count,
      });
    }

    return rankings.sort((a, b) => b.riskScore - a.riskScore);
  }
}

export interface RiskCalculationResult {
  entityType: EntityType;
  entityId: string;
  baseRiskScore: number;
  adjustedRiskScore: number;
  riskLevel: string;
  riskFactors: Record<string, number>;
}

export interface DepartmentRiskRanking {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  riskScore: number;
  riskLevel: string;
  affectedEntityCount: number;
}

// Export singleton functions for convenience
export async function propagateImpact(config: PropagationConfig): Promise<PropagationResult> {
  const engine = new PropagationEngine(config.tenantId);
  return engine.propagate(config);
}

export async function calculateRiskScores(tenantId: string): Promise<RiskCalculationResult[]> {
  const calculator = new RiskIndexCalculator(tenantId);
  return calculator.calculateAllRisks();
}
