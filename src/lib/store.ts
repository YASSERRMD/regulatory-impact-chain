import { create } from "zustand";

// Types
export interface Tenant {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  settings?: Record<string, unknown>;
  createdAt: string;
  counts?: {
    departments: number;
    regulations: number;
    services: number;
    kpis: number;
    budgets: number;
  };
}

export interface Regulation {
  id: string;
  name: string;
  code: string;
  description?: string;
  departmentId?: string;
  regulationType?: string;
  effectiveDate: string;
  expirationDate?: string;
  status: string;
  severity: string;
  version: number;
  department?: { id: string; name: string; code: string };
  impactCount?: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  parentId?: string;
  parent?: { id: string; name: string; code: string };
  children?: Department[];
  childCount?: number;
  regulationCount?: number;
}

export interface Budget {
  id: string;
  name: string;
  code: string;
  departmentId?: string;
  amount: number;
  currency: string;
  fiscalYear: number;
  category?: string;
}

export interface Service {
  id: string;
  name: string;
  code: string;
  departmentId?: string;
  description?: string;
  serviceType?: string;
  status: string;
}

export interface KPI {
  id: string;
  name: string;
  code: string;
  departmentId?: string;
  description?: string;
  unit?: string;
  targetValue?: number;
  currentValue?: number;
  measurementFrequency?: string;
}

export interface ImpactEdge {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  impactWeight: number;
  impactType: string;
  impactCategory?: string;
  description?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  key: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceId: string;
  targetId: string;
  sourceType: string;
  targetType: string;
  weight: number;
  impactType: string;
  category?: string;
}

export interface RiskScore {
  entityType: string;
  entityId: string;
  baseRiskScore: number;
  adjustedRiskScore: number;
  riskLevel: string;
  riskFactors: Record<string, number>;
}

export interface PropagationResult {
  sourceId: string;
  sourceType: string;
  totalAffected: number;
  maxDepth: number;
  executionTime: number;
  affectedEntities: Array<{
    id: string;
    type: string;
    name: string;
    impactScore: number;
    depth: number;
  }>;
}

export interface Simulation {
  id: string;
  name: string;
  description?: string;
  simulationType: string;
  status: string;
  results?: Record<string, unknown>;
  createdAt: string;
  regulation?: { id: string; name: string; code: string };
}

// Store State
interface AppState {
  // Current tenant
  currentTenant: Tenant | null;
  tenants: Tenant[];
  
  // Entities
  regulations: Regulation[];
  departments: Department[];
  budgets: Budget[];
  services: Service[];
  kpis: KPI[];
  
  // Graph
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  
  // Risk & Propagation
  riskScores: RiskScore[];
  riskSummary: {
    totalEntities: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  } | null;
  propagationResult: PropagationResult | null;
  
  // Simulations
  simulations: Simulation[];
  
  // UI State
  activeTab: string;
  selectedEntity: { type: string; id: string } | null;
  isLoading: boolean;
  socketConnected: boolean;
  
  // Actions
  setCurrentTenant: (tenant: Tenant | null) => void;
  setTenants: (tenants: Tenant[]) => void;
  setRegulations: (regulations: Regulation[]) => void;
  addRegulation: (regulation: Regulation) => void;
  updateRegulation: (id: string, regulation: Partial<Regulation>) => void;
  removeRegulation: (id: string) => void;
  setDepartments: (departments: Department[]) => void;
  addDepartment: (department: Department) => void;
  removeDepartment: (id: string) => void;
  setBudgets: (budgets: Budget[]) => void;
  addBudget: (budget: Budget) => void;
  removeBudget: (id: string) => void;
  setServices: (services: Service[]) => void;
  addService: (service: Service) => void;
  removeService: (id: string) => void;
  setKPIs: (kpis: KPI[]) => void;
  addKPI: (kpi: KPI) => void;
  removeKPI: (id: string) => void;
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  setRiskScores: (scores: RiskScore[], summary: AppState['riskSummary']) => void;
  setPropagationResult: (result: PropagationResult | null) => void;
  setSimulations: (simulations: Simulation[]) => void;
  setActiveTab: (tab: string) => void;
  setSelectedEntity: (entity: { type: string; id: string } | null) => void;
  setIsLoading: (loading: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  // Initial state
  currentTenant: null,
  tenants: [],
  regulations: [],
  departments: [],
  budgets: [],
  services: [],
  kpis: [],
  graphNodes: [],
  graphEdges: [],
  riskScores: [],
  riskSummary: null,
  propagationResult: null,
  simulations: [],
  activeTab: "overview",
  selectedEntity: null,
  isLoading: false,
  socketConnected: false,
  
  // Actions
  setCurrentTenant: (tenant) => set({ currentTenant: tenant }),
  setTenants: (tenants) => set({ tenants }),
  setRegulations: (regulations) => set({ regulations }),
  addRegulation: (regulation) => set((state) => ({ 
    regulations: [...state.regulations, regulation] 
  })),
  updateRegulation: (id, regulation) => set((state) => ({
    regulations: state.regulations.map((r) => 
      r.id === id ? { ...r, ...regulation } : r
    ),
  })),
  removeRegulation: (id) => set((state) => ({ 
    regulations: state.regulations.filter((r) => r.id !== id) 
  })),
  setDepartments: (departments) => set({ departments }),
  addDepartment: (department) => set((state) => ({ 
    departments: [...state.departments, department] 
  })),
  removeDepartment: (id) => set((state) => ({ 
    departments: state.departments.filter((d) => d.id !== id) 
  })),
  setBudgets: (budgets) => set({ budgets }),
  addBudget: (budget) => set((state) => ({ 
    budgets: [...state.budgets, budget] 
  })),
  removeBudget: (id) => set((state) => ({ 
    budgets: state.budgets.filter((b) => b.id !== id) 
  })),
  setServices: (services) => set({ services }),
  addService: (service) => set((state) => ({ 
    services: [...state.services, service] 
  })),
  removeService: (id) => set((state) => ({ 
    services: state.services.filter((s) => s.id !== id) 
  })),
  setKPIs: (kpis) => set({ kpis }),
  addKPI: (kpi) => set((state) => ({ 
    kpis: [...state.kpis, kpi] 
  })),
  removeKPI: (id) => set((state) => ({ 
    kpis: state.kpis.filter((k) => k.id !== id) 
  })),
  setGraphData: (nodes, edges) => set({ graphNodes: nodes, graphEdges: edges }),
  setRiskScores: (scores, summary) => set({ riskScores: scores, riskSummary: summary }),
  setPropagationResult: (result) => set({ propagationResult: result }),
  setSimulations: (simulations) => set({ simulations }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setSocketConnected: (connected) => set({ socketConnected: connected }),
}));
