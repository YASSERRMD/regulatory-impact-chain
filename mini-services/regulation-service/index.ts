import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const PORT = 3003;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Store connected clients per tenant
const tenantClients = new Map<string, Set<string>>();

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join tenant-specific room for multi-tenant isolation
  socket.on("join-tenant", (tenantId: string) => {
    socket.join(`tenant:${tenantId}`);
    if (!tenantClients.has(tenantId)) {
      tenantClients.set(tenantId, new Set());
    }
    tenantClients.get(tenantId)!.add(socket.id);
    console.log(`Client ${socket.id} joined tenant ${tenantId}`);
  });

  // Leave tenant room
  socket.on("leave-tenant", (tenantId: string) => {
    socket.leave(`tenant:${tenantId}`);
    tenantClients.get(tenantId)?.delete(socket.id);
    console.log(`Client ${socket.id} left tenant ${tenantId}`);
  });

  // Subscribe to specific regulation updates
  socket.on("subscribe-regulation", (data: { tenantId: string; regulationId: string }) => {
    socket.join(`regulation:${data.tenantId}:${data.regulationId}`);
    console.log(`Client ${socket.id} subscribed to regulation ${data.regulationId}`);
  });

  // Unsubscribe from regulation
  socket.on("unsubscribe-regulation", (data: { tenantId: string; regulationId: string }) => {
    socket.leave(`regulation:${data.tenantId}:${data.regulationId}`);
  });

  // Subscribe to entity updates
  socket.on("subscribe-entity", (data: { tenantId: string; entityType: string; entityId: string }) => {
    socket.join(`entity:${data.tenantId}:${data.entityType}:${data.entityId}`);
  });

  socket.on("unsubscribe-entity", (data: { tenantId: string; entityType: string; entityId: string }) => {
    socket.leave(`entity:${data.tenantId}:${data.entityType}:${data.entityId}`);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Clean up tenant clients map
    tenantClients.forEach((clients, tenantId) => {
      clients.delete(socket.id);
      if (clients.size === 0) {
        tenantClients.delete(tenantId);
      }
    });
  });
});

// Event types for type safety
export interface RecalculationEvent {
  type: "RECALCULATION_START" | "RECALCULATION_PROGRESS" | "RECALCULATION_COMPLETE" | "RECALCULATION_ERROR";
  tenantId: string;
  regulationId?: string;
  entityType?: string;
  entityId?: string;
  progress?: number;
  totalSteps?: number;
  affectedEntities?: Array<{
    type: string;
    id: string;
    impactScore: number;
  }>;
  error?: string;
  timestamp: Date;
}

export interface ImpactChangeEvent {
  type: "IMPACT_UPDATE";
  tenantId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  oldImpact: number;
  newImpact: number;
  propagationPath: Array<{
    type: string;
    id: string;
    weight: number;
  }>;
  timestamp: Date;
}

export interface RiskUpdateEvent {
  type: "RISK_UPDATE";
  tenantId: string;
  entityType: string;
  entityId: string;
  oldRiskScore: number;
  newRiskScore: number;
  riskLevel: string;
  riskFactors: Record<string, number>;
  timestamp: Date;
}

export interface SimulationEvent {
  type: "SIMULATION_START" | "SIMULATION_PROGRESS" | "SIMULATION_COMPLETE" | "SIMULATION_ERROR";
  tenantId: string;
  simulationId: string;
  progress?: number;
  results?: Record<string, unknown>;
  error?: string;
  timestamp: Date;
}

// Helper functions to emit events (to be called from API routes)
export function emitRecalculationEvent(event: RecalculationEvent) {
  io.to(`tenant:${event.tenantId}`).emit("recalculation", event);
  if (event.regulationId) {
    io.to(`regulation:${event.tenantId}:${event.regulationId}`).emit("recalculation", event);
  }
}

export function emitImpactChangeEvent(event: ImpactChangeEvent) {
  io.to(`tenant:${event.tenantId}`).emit("impact-change", event);
  io.to(`entity:${event.tenantId}:${event.targetType}:${event.targetId}`).emit("impact-change", event);
}

export function emitRiskUpdateEvent(event: RiskUpdateEvent) {
  io.to(`tenant:${event.tenantId}`).emit("risk-update", event);
  io.to(`entity:${event.tenantId}:${event.entityType}:${event.entityId}`).emit("risk-update", event);
}

export function emitSimulationEvent(event: SimulationEvent) {
  io.to(`tenant:${event.tenantId}`).emit("simulation", event);
}

// Export io for external use
export { io };

httpServer.listen(PORT, () => {
  console.log(`Regulation Socket.io Service running on port ${PORT}`);
});
