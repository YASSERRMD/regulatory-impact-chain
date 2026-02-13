"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  BarChart3, Building2, Calculator, DollarSign, FileText, GitBranch, Plus, 
  RefreshCw, Server, Shield, Target, Zap, Activity, TrendingUp, Loader2, 
  Play, Wifi, WifiOff
} from "lucide-react";
import { io, Socket } from "socket.io-client";

// Fetch helper
async function fetchApi<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    return await res.json();
  } catch {
    return { success: false, error: "Request failed" };
  }
}

// Risk colors
const riskColors: Record<string, string> = {
  Critical: "bg-red-500 text-white",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-400 text-black",
  Low: "bg-green-500 text-white",
};

const riskBgColors: Record<string, string> = {
  Critical: "bg-red-50 border-red-200",
  High: "bg-orange-50 border-orange-200",
  Medium: "bg-yellow-50 border-yellow-200",
  Low: "bg-green-50 border-green-200",
};

const entityColors: Record<string, string> = {
  DEPARTMENT: "#3b82f6",
  BUDGET: "#10b981",
  SERVICE: "#8b5cf6",
  KPI: "#f59e0b",
  REGULATION: "#ef4444",
};

export default function RegulatoryImpactVisualizer() {
  const store = useStore();
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Form states
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateRegulation, setShowCreateRegulation] = useState(false);
  const [showCreateDepartment, setShowCreateDepartment] = useState(false);
  const [showCreateEdge, setShowCreateEdge] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", code: "" });
  const [newRegulation, setNewRegulation] = useState({
    name: "", code: "", description: "", severity: "Medium" as const,
    status: "Draft" as const, effectiveDate: new Date().toISOString().split("T")[0]
  });
  const [newDepartment, setNewDepartment] = useState({ name: "", code: "", description: "" });
  const [newEdge, setNewEdge] = useState({
    sourceType: "REGULATION", sourceId: "",
    targetType: "DEPARTMENT", targetId: "",
    impactWeight: 1.0, impactType: "Direct" as const
  });

  // Load data on mount and tenant change
  useEffect(() => {
    async function loadData() {
      const result = await fetchApi<{ data: unknown[] }>("/api/tenants");
      if (result.success && result.data) {
        // @ts-expect-error dynamic data
        const tenants = result.data;
        store.setTenants(tenants);
        if (tenants.length > 0 && !store.currentTenant) {
          store.setCurrentTenant(tenants[0]);
        }
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!store.currentTenant) return;
    
    async function loadTenantData() {
      const tenantId = store.currentTenant!.id;
      store.setIsLoading(true);
      
      const [regs, depts, budgets, services, kpis, graph, risks] = await Promise.all([
        fetchApi<{ data: unknown[] }>(`/api/tenants/${tenantId}/regulations`),
        fetchApi<{ data: unknown[] }>(`/api/tenants/${tenantId}/departments`),
        fetchApi<{ data: unknown[] }>(`/api/tenants/${tenantId}/budgets`),
        fetchApi<{ data: unknown[] }>(`/api/tenants/${tenantId}/services`),
        fetchApi<{ data: unknown[] }>(`/api/tenants/${tenantId}/kpis`),
        fetchApi<{ data: { nodes: unknown[]; edges: unknown[] } }>(`/api/tenants/${tenantId}/graph`),
        fetchApi<{ data: { risks: unknown[]; summary: unknown } }>(`/api/tenants/${tenantId}/risks?rankings=true`),
      ]);
      
      if (regs.success && regs.data) store.setRegulations(regs.data as never[]);
      if (depts.success && depts.data) store.setDepartments(depts.data as never[]);
      if (budgets.success && budgets.data) store.setBudgets(budgets.data as never[]);
      if (services.success && services.data) store.setServices(services.data as never[]);
      if (kpis.success && kpis.data) store.setKPIs(kpis.data as never[]);
      if (graph.success && graph.data) {
        // @ts-expect-error dynamic data
        store.setGraphData(graph.data.nodes, graph.data.edges);
      }
      if (risks.success && risks.data) {
        // @ts-expect-error dynamic data
        store.setRiskScores(risks.data.risks || [], risks.data.summary);
      }
      
      store.setIsLoading(false);
    }
    
    loadTenantData();
    
    // Connect socket
    try {
      if (socketRef.current) socketRef.current.disconnect();
      socketRef.current = io("/?XTransformPort=3003", { transports: ["websocket", "polling"] });
      socketRef.current.on("connect", () => {
        store.setSocketConnected(true);
        socketRef.current?.emit("join-tenant", tenantId);
      });
      socketRef.current.on("disconnect", () => store.setSocketConnected(false));
    } catch {
      store.setSocketConnected(false);
    }
    
    return () => { socketRef.current?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentTenant?.id]);

  // Draw graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || store.graphNodes.length === 0) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);
    
    // Layout nodes in circle
    const nodes = store.graphNodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / store.graphNodes.length;
      const radius = Math.min(width, height) * 0.35;
      return { ...node, x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) };
    });
    
    // Draw edges
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    store.graphEdges.forEach(edge => {
      const source = nodes.find(n => n.key === edge.source);
      const target = nodes.find(n => n.key === edge.target);
      if (source && target) {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
    });
    
    // Draw nodes
    nodes.forEach(node => {
      const color = entityColors[node.type] || "#6b7280";
      ctx.beginPath();
      ctx.arc(node.x, node.y, 15, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      
      // Label
      ctx.fillStyle = "#334155";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      const label = node.label.length > 10 ? node.label.slice(0, 10) + "..." : node.label;
      ctx.fillText(label, node.x, node.y + 28);
    });
  }, [store.graphNodes, store.graphEdges]);

  // Actions
  const createTenant = async () => {
    const result = await fetchApi("/api/tenants", { method: "POST", body: JSON.stringify(newTenant) });
    if (result.success && result.data) {
      // @ts-expect-error dynamic data
      store.setTenants([...store.tenants, result.data]);
      // @ts-expect-error dynamic data
      store.setCurrentTenant(result.data);
      setShowCreateTenant(false);
      setNewTenant({ name: "", code: "" });
    }
  };

  const createRegulation = async () => {
    if (!store.currentTenant) return;
    const result = await fetchApi(`/api/tenants/${store.currentTenant.id}/regulations`, { method: "POST", body: JSON.stringify(newRegulation) });
    if (result.success && result.data) {
      store.addRegulation(result.data as never);
      setShowCreateRegulation(false);
    }
  };

  const createDepartment = async () => {
    if (!store.currentTenant) return;
    const result = await fetchApi(`/api/tenants/${store.currentTenant.id}/departments`, { method: "POST", body: JSON.stringify(newDepartment) });
    if (result.success && result.data) {
      store.addDepartment(result.data as never);
      setShowCreateDepartment(false);
    }
  };

  const createEdge = async () => {
    if (!store.currentTenant) return;
    await fetchApi(`/api/tenants/${store.currentTenant.id}/edges`, { method: "POST", body: JSON.stringify(newEdge) });
    setShowCreateEdge(false);
    // Reload graph
    const result = await fetchApi<{ data: { nodes: unknown[]; edges: unknown[] } }>(`/api/tenants/${store.currentTenant.id}/graph`);
    if (result.success && result.data) {
      // @ts-expect-error dynamic data
      store.setGraphData(result.data.nodes, result.data.edges);
    }
  };

  const runPropagation = async (regulationId: string) => {
    if (!store.currentTenant) return;
    const result = await fetchApi(`/api/tenants/${store.currentTenant.id}/regulations/${regulationId}/propagate`, { method: "POST", body: JSON.stringify({ maxDepth: 10 }) });
    if (result.success && result.data) {
      store.setPropagationResult(result.data as never);
    }
  };

  const recalculateRisks = async () => {
    if (!store.currentTenant) return;
    await fetchApi(`/api/tenants/${store.currentTenant.id}/risks`, { method: "POST" });
    const result = await fetchApi<{ data: { risks: unknown[]; summary: unknown } }>(`/api/tenants/${store.currentTenant.id}/risks?rankings=true`);
    if (result.success && result.data) {
      // @ts-expect-error dynamic data
      store.setRiskScores(result.data.risks || [], result.data.summary);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
              <GitBranch className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Regulatory Impact Chain Visualizer</h1>
              <p className="text-xs text-slate-500">Real-time dependency propagation & risk analysis</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${store.socketConnected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {store.socketConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              <span>{store.socketConnected ? "Connected" : "Disconnected"}</span>
            </div>

            <Select value={store.currentTenant?.id || ""} onValueChange={(id) => store.setCurrentTenant(store.tenants.find(t => t.id === id) || null)}>
              <SelectTrigger className="w-[200px] bg-white border-slate-300">
                <SelectValue placeholder="Select Tenant" />
              </SelectTrigger>
              <SelectContent>
                {store.tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button size="sm" onClick={() => setShowCreateTenant(true)}>
              <Plus className="w-4 h-4 mr-1" /> Tenant
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {store.isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : !store.currentTenant ? (
          <Card className="bg-white border-slate-200">
            <CardContent className="py-12 text-center">
              <Server className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <h2 className="text-xl font-semibold mb-2">No Tenant Selected</h2>
              <p className="text-slate-500 mb-4">Create or select a tenant to get started</p>
              <Button onClick={() => setShowCreateTenant(true)}>
                <Plus className="w-4 h-4 mr-2" /> Create Tenant
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={store.activeTab} onValueChange={store.setActiveTab}>
            <TabsList className="bg-slate-100 border-slate-200 mb-6">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white"><BarChart3 className="w-4 h-4 mr-2" /> Overview</TabsTrigger>
              <TabsTrigger value="regulations" className="data-[state=active]:bg-white"><FileText className="w-4 h-4 mr-2" /> Regulations</TabsTrigger>
              <TabsTrigger value="entities" className="data-[state=active]:bg-white"><Building2 className="w-4 h-4 mr-2" /> Entities</TabsTrigger>
              <TabsTrigger value="graph" className="data-[state=active]:bg-white"><GitBranch className="w-4 h-4 mr-2" /> Graph</TabsTrigger>
              <TabsTrigger value="risks" className="data-[state=active]:bg-white"><Shield className="w-4 h-4 mr-2" /> Risks</TabsTrigger>
              <TabsTrigger value="simulation" className="data-[state=active]:bg-white"><Play className="w-4 h-4 mr-2" /> Simulation</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Regulations</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{store.regulations.length}</div>
                    <p className="text-xs text-slate-500">{store.regulations.filter(r => r.status === "Active").length} active</p>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Departments</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{store.departments.length}</div>
                    <p className="text-xs text-slate-500">{store.graphEdges.length} edges</p>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Critical Risks</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-red-600">{store.riskSummary?.criticalCount || 0}</div>
                    <p className="text-xs text-slate-500">critical entities</p>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Impact Paths</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{store.graphEdges.length}</div>
                    <p className="text-xs text-slate-500">connections</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Dependency Graph</CardTitle>
                    <CardDescription>{store.graphNodes.length} nodes, {store.graphEdges.length} edges</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <canvas ref={canvasRef} width={500} height={350} className="w-full rounded-lg border border-slate-200" />
                    <div className="flex flex-wrap gap-3 mt-3">
                      {Object.entries(entityColors).map(([type, color]) => (
                        <div key={type} className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-xs text-slate-500">{type}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader><CardTitle>Risk Distribution</CardTitle></CardHeader>
                  <CardContent>
                    {store.riskSummary ? (
                      <div className="space-y-4">
                        {(["Critical", "High", "Medium", "Low"] as const).map(level => {
                          const count = store.riskSummary![`${level.toLowerCase()}Count` as keyof typeof store.riskSummary] as number;
                          const total = store.riskSummary!.totalEntities || 1;
                          const colors: Record<string, { bg: string; text: string }> = {
                            Critical: { bg: "bg-red-500", text: "text-red-600" },
                            High: { bg: "bg-orange-500", text: "text-orange-600" },
                            Medium: { bg: "bg-yellow-400", text: "text-yellow-600" },
                            Low: { bg: "bg-green-500", text: "text-green-600" },
                          };
                          return (
                            <div key={level}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className={colors[level].text + " font-medium"}>{level}</span>
                                <span className="font-medium">{count}</span>
                              </div>
                              <Progress value={(count / total) * 100} className={`h-3 bg-slate-100 [&>div]:${colors[level].bg}`} />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-center py-8">No risk data. Click Recalculate.</p>
                    )}
                  </CardContent>
                  <CardFooter>
                    <Button variant="outline" size="sm" onClick={recalculateRisks}>
                      <Calculator className="w-4 h-4 mr-2" /> Recalculate Risks
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </TabsContent>

            {/* Regulations Tab */}
            <TabsContent value="regulations">
              <Card className="bg-white border-slate-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Regulations</CardTitle>
                    <Button onClick={() => setShowCreateRegulation(true)}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead>
                          <TableHead>Severity</TableHead><TableHead>Effective</TableHead><TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {store.regulations.slice(0, 50).map(reg => (
                          <TableRow key={reg.id} className="hover:bg-slate-50">
                            <TableCell className="font-mono text-sm">{reg.code}</TableCell>
                            <TableCell className="font-medium">{reg.name}</TableCell>
                            <TableCell><Badge variant={reg.status === "Active" ? "default" : "secondary"}>{reg.status}</Badge></TableCell>
                            <TableCell><Badge className={riskColors[reg.severity]}>{reg.severity}</Badge></TableCell>
                            <TableCell>{new Date(reg.effectiveDate).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" onClick={() => runPropagation(reg.id)}><Zap className="w-4 h-4" /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Entities Tab */}
            <TabsContent value="entities">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-500" /> Departments</CardTitle>
                    <Button size="sm" onClick={() => setShowCreateDepartment(true)}><Plus className="w-4 h-4" /></Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      {store.departments.slice(0, 20).map(d => (
                        <div key={d.id} className="flex items-center justify-between p-2 border-b border-slate-100">
                          <div><p className="font-medium">{d.name}</p><p className="text-xs text-slate-500">{d.code}</p></div>
                          <Badge variant="outline">{d.regulationCount || 0} regs</Badge>
                        </div>
                      ))}
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-green-500" /> Budgets</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      {store.budgets.slice(0, 20).map(b => (
                        <div key={b.id} className="flex items-center justify-between p-2 border-b border-slate-100">
                          <div><p className="font-medium">{b.name}</p><p className="text-xs text-slate-500">FY{b.fiscalYear}</p></div>
                          <Badge variant="outline" className="bg-green-50 text-green-700">{b.currency} {b.amount.toLocaleString()}</Badge>
                        </div>
                      ))}
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader><CardTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-purple-500" /> Services</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      {store.services.slice(0, 20).map(s => (
                        <div key={s.id} className="flex items-center justify-between p-2 border-b border-slate-100">
                          <div><p className="font-medium">{s.name}</p><p className="text-xs text-slate-500">{s.serviceType}</p></div>
                          <Badge variant={s.status === "Active" ? "default" : "secondary"}>{s.status}</Badge>
                        </div>
                      ))}
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader><CardTitle className="flex items-center gap-2"><Target className="w-5 h-5 text-orange-500" /> KPIs</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      {store.kpis.slice(0, 20).map(k => (
                        <div key={k.id} className="flex items-center justify-between p-2 border-b border-slate-100">
                          <div><p className="font-medium">{k.name}</p><p className="text-xs text-slate-500">{k.unit}</p></div>
                          <div className="text-right"><p className="text-sm">{k.currentValue}</p><p className="text-xs text-slate-500">target: {k.targetValue}</p></div>
                        </div>
                      ))}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Graph Tab */}
            <TabsContent value="graph">
              <Card className="bg-white border-slate-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div><CardTitle>Dependency Graph</CardTitle><CardDescription>{store.graphNodes.length} nodes, {store.graphEdges.length} edges</CardDescription></div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowCreateEdge(true)}><Plus className="w-4 h-4 mr-2" /> Add Edge</Button>
                      <Button variant="outline" size="sm" onClick={() => window.location.reload()}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <canvas ref={canvasRef} width={800} height={500} className="w-full rounded-lg border border-slate-200 bg-slate-50" />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Risk Tab */}
            <TabsContent value="risks">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="bg-white border-slate-200 shadow-sm lg:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Risk Scores</CardTitle>
                    <Button onClick={recalculateRisks}><Calculator className="w-4 h-4 mr-2" /> Recalculate</Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Entity</TableHead><TableHead>Type</TableHead><TableHead>Score</TableHead><TableHead>Level</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {store.riskScores.slice(0, 50).map((r, i) => (
                            <TableRow key={i} className="hover:bg-slate-50">
                              <TableCell>{r.entityId}</TableCell>
                              <TableCell>{r.entityType}</TableCell>
                              <TableCell>{r.adjustedRiskScore.toFixed(2)}</TableCell>
                              <TableCell><Badge className={riskColors[r.riskLevel]}>{r.riskLevel}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
                  <CardContent>
                    {store.riskSummary && (
                      <div className="space-y-4">
                        <div className="text-center p-4 bg-slate-50 rounded-lg">
                          <p className="text-4xl font-bold">{store.riskSummary.totalEntities}</p>
                          <p className="text-sm text-slate-500">Total Entities</p>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-2">
                          {(["Critical", "High", "Medium", "Low"] as const).map(level => {
                            const count = store.riskSummary![`${level.toLowerCase()}Count` as keyof typeof store.riskSummary] as number;
                            return (
                              <div key={level} className={`text-center p-3 rounded ${riskBgColors[level]}`}>
                                <p className="text-2xl font-bold">{count}</p>
                                <p className="text-xs">{level}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Simulation Tab */}
            <TabsContent value="simulation">
              <Card className="bg-white border-slate-200 shadow-sm">
                <CardHeader><CardTitle>Simulation Results</CardTitle></CardHeader>
                <CardContent>
                  {store.propagationResult ? (
                    <div className="space-y-4">
                      <Alert className="bg-blue-50 border-blue-200">
                        <Activity className="w-4 h-4 text-blue-600" />
                        <AlertTitle className="text-blue-800">Propagation Complete</AlertTitle>
                        <AlertDescription className="text-blue-700">
                          Affected {(store.propagationResult as { totalAffected: number }).totalAffected} entities
                        </AlertDescription>
                      </Alert>
                      <ScrollArea className="h-[400px]">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50">
                              <TableHead>Entity</TableHead><TableHead>Type</TableHead><TableHead>Impact</TableHead><TableHead>Depth</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {/* @ts-expect-error dynamic data */}
                            {store.propagationResult.affectedEntities?.slice(0, 50).map((e: { name: string; type: string; impactScore: number; depth: number }, i: number) => (
                              <TableRow key={i} className="hover:bg-slate-50">
                                <TableCell>{e.name}</TableCell>
                                <TableCell>{e.type}</TableCell>
                                <TableCell><Badge>{e.impactScore.toFixed(2)}</Badge></TableCell>
                                <TableCell>{e.depth}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <TrendingUp className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                      <p className="text-slate-500">Run propagation from Regulations tab to see results</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-slate-500">
          Regulatory Impact Chain Visualizer • Multi-tenant • Real-time Analysis
        </div>
      </footer>

      {/* Dialogs */}
      <Dialog open={showCreateTenant} onOpenChange={setShowCreateTenant}>
        <DialogContent className="bg-white border-slate-200">
          <DialogHeader><DialogTitle>Create Tenant</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={newTenant.name} onChange={e => setNewTenant({ ...newTenant, name: e.target.value })} /></div>
            <div><Label>Code</Label><Input value={newTenant.code} onChange={e => setNewTenant({ ...newTenant, code: e.target.value.toUpperCase() })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreateTenant(false)}>Cancel</Button><Button onClick={createTenant}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateRegulation} onOpenChange={setShowCreateRegulation}>
        <DialogContent className="bg-white border-slate-200 max-w-md">
          <DialogHeader><DialogTitle>Create Regulation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={newRegulation.name} onChange={e => setNewRegulation({ ...newRegulation, name: e.target.value })} /></div>
            <div><Label>Code</Label><Input value={newRegulation.code} onChange={e => setNewRegulation({ ...newRegulation, code: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Severity</Label>
                <Select value={newRegulation.severity} onValueChange={v => setNewRegulation({ ...newRegulation, severity: v as "Low" | "Medium" | "High" | "Critical" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Low", "Medium", "High", "Critical"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={newRegulation.status} onValueChange={v => setNewRegulation({ ...newRegulation, status: v as "Draft" | "Active" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Draft", "Active"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Effective Date</Label><Input type="date" value={newRegulation.effectiveDate} onChange={e => setNewRegulation({ ...newRegulation, effectiveDate: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreateRegulation(false)}>Cancel</Button><Button onClick={createRegulation}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateDepartment} onOpenChange={setShowCreateDepartment}>
        <DialogContent className="bg-white border-slate-200">
          <DialogHeader><DialogTitle>Create Department</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={newDepartment.name} onChange={e => setNewDepartment({ ...newDepartment, name: e.target.value })} /></div>
            <div><Label>Code</Label><Input value={newDepartment.code} onChange={e => setNewDepartment({ ...newDepartment, code: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreateDepartment(false)}>Cancel</Button><Button onClick={createDepartment}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateEdge} onOpenChange={setShowCreateEdge}>
        <DialogContent className="bg-white border-slate-200 max-w-md">
          <DialogHeader><DialogTitle>Create Impact Edge</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Source Type</Label>
                <Select value={newEdge.sourceType} onValueChange={v => setNewEdge({ ...newEdge, sourceType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["REGULATION", "DEPARTMENT", "BUDGET", "SERVICE", "KPI"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Target Type</Label>
                <Select value={newEdge.targetType} onValueChange={v => setNewEdge({ ...newEdge, targetType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["DEPARTMENT", "BUDGET", "SERVICE", "KPI"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Source</Label>
                <Select value={newEdge.sourceId} onValueChange={v => setNewEdge({ ...newEdge, sourceId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {newEdge.sourceType === "REGULATION" && store.regulations.slice(0, 20).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    {newEdge.sourceType === "DEPARTMENT" && store.departments.slice(0, 20).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Target</Label>
                <Select value={newEdge.targetId} onValueChange={v => setNewEdge({ ...newEdge, targetId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {newEdge.targetType === "DEPARTMENT" && store.departments.slice(0, 20).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    {newEdge.targetType === "SERVICE" && store.services.slice(0, 20).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    {newEdge.targetType === "BUDGET" && store.budgets.slice(0, 20).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    {newEdge.targetType === "KPI" && store.kpis.slice(0, 20).map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Impact Weight (0-1)</Label><Input type="number" step="0.1" value={newEdge.impactWeight} onChange={e => setNewEdge({ ...newEdge, impactWeight: parseFloat(e.target.value) })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreateEdge(false)}>Cancel</Button><Button onClick={createEdge}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
