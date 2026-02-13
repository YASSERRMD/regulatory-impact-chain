import { PrismaClient, EntityType } from "@prisma/client";

const prisma = new PrismaClient();

// Severity and status options
const severities = ["Low", "Medium", "High", "Critical"] as const;
const statuses = ["Draft", "Active", "Superseded", "Revoked"] as const;
const regulationTypes = ["Compliance", "Policy", "Standard", "Law"] as const;
const serviceTypes = ["Internal", "External", "Shared"] as const;
const serviceStatuses = ["Active", "Deprecated", "Planned"] as const;
const measurementFrequencies = ["Daily", "Weekly", "Monthly", "Quarterly"] as const;
const impactTypes = ["Direct", "Indirect", "Conditional"] as const;
const impactCategories = ["Financial", "Operational", "Compliance", "Strategic", "Technical"] as const;

// Sample data generators
const departments = [
  { name: "Finance", code: "FIN" },
  { name: "Human Resources", code: "HR" },
  { name: "Information Technology", code: "IT" },
  { name: "Operations", code: "OPS" },
  { name: "Legal & Compliance", code: "LEGAL" },
  { name: "Marketing", code: "MKT" },
  { name: "Sales", code: "SALES" },
  { name: "Research & Development", code: "RND" },
  { name: "Customer Service", code: "CS" },
  { name: "Supply Chain", code: "SC" },
  { name: "Quality Assurance", code: "QA" },
  { name: "Risk Management", code: "RISK" },
  { name: "Procurement", code: "PROC" },
  { name: "Facilities", code: "FAC" },
  { name: "Security", code: "SEC" },
];

const regulationPrefixes = [
  "GDPR", "SOX", "HIPAA", "PCI-DSS", "ISO", "FERPA", "Dodd-Frank", 
  "Basel", "MiFID", "AML", "KYC", "FATCA", "PSD2", "CCPA", "DPDPA",
  "NIST", "FedRAMP", "SOC2", "COBIT", "ITIL"
];

const regulationSuffixes = [
  "Compliance", "Data Protection", "Security Standard", "Reporting",
  "Audit Requirement", "Privacy Rule", "Implementation Guide", "Framework"
];

const serviceNames = [
  "User Authentication Service", "Payment Processing", "Data Analytics Platform",
  "Customer Portal", "API Gateway", "Document Management", "Email Service",
  "Backup & Recovery", "Monitoring System", "Identity Management", "CRM Integration",
  "Inventory Tracking", "Reporting Dashboard", "Workflow Automation", "Chat Service",
  "File Storage", "Notification System", "Search Engine", "Cache Service", "Queue Management"
];

const kpiNames = [
  "Customer Satisfaction Score", "Employee Turnover Rate", "Revenue Growth",
  "Operational Efficiency", "Cost Per Transaction", "System Uptime",
  "Response Time", "Error Rate", "Compliance Score", "Data Quality Index",
  "Processing Volume", "Customer Retention", "Net Promoter Score", "Bug Resolution Time",
  "Deployment Frequency", "Lead Conversion Rate", "Inventory Turnover", "Cash Flow",
  "Debt Ratio", "Profit Margin", "Return on Investment", "Market Share",
  "Employee Productivity", "Training Completion", "Security Incident Count"
];

const budgetCategories = [
  "Operational", "Capital", "Personnel", "Technology", "Marketing",
  "Research", "Training", "Compliance", "Infrastructure", "Emergency"
];

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateCode(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

async function main() {
  console.log("🌱 Starting seed...");

  // Clean existing data
  console.log("🧹 Cleaning existing data...");
  await prisma.regulationImpact.deleteMany();
  await prisma.riskScore.deleteMany();
  await prisma.simulation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.impactEdge.deleteMany();
  await prisma.cachedGraph.deleteMany();
  await prisma.regulation.deleteMany();
  await prisma.kPI.deleteMany();
  await prisma.service.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.department.deleteMany();
  await prisma.tenant.deleteMany();

  console.log("✅ Database cleaned");

  // Create multiple tenants
  const tenants = [];
  const tenantData = [
    { name: "Acme Corporation", code: "ACME" },
    { name: "Global Finance Inc", code: "GFI" },
    { name: "Tech Innovations Ltd", code: "TECH" },
    { name: "Healthcare Partners", code: "HCARE" },
    { name: "Manufacturing Solutions", code: "MFG" },
  ];

  for (const t of tenantData) {
    const tenant = await prisma.tenant.create({
      data: {
        name: t.name,
        code: t.code,
        isActive: true,
        settings: { theme: "dark", notifications: true },
      },
    });
    tenants.push(tenant);
    console.log(`🏢 Created tenant: ${tenant.name}`);
  }

  // For each tenant, create entities
  for (const tenant of tenants) {
    console.log(`\n📦 Seeding data for tenant: ${tenant.name}`);

    // Create departments
    const createdDepartments = [];
    for (let i = 0; i < departments.length; i++) {
      const dept = departments[i];
      const parent = i > 5 && createdDepartments.length > 0 
        ? randomElement(createdDepartments.slice(0, 5)) 
        : null;

      const department = await prisma.department.create({
        data: {
          tenantId: tenant.id,
          name: dept.name,
          code: dept.code,
          description: `${dept.name} department responsible for ${dept.name.toLowerCase()} related activities`,
          parentId: parent?.id,
          isActive: true,
          metadata: { headcount: randomInt(10, 200), location: randomElement(["HQ", "Branch A", "Branch B", "Remote"]) },
        },
      });
      createdDepartments.push(department);
    }
    console.log(`  ✓ Created ${createdDepartments.length} departments`);

    // Create budgets
    const createdBudgets = [];
    for (const dept of createdDepartments) {
      // Each department gets 1-3 budgets
      const budgetCount = randomInt(1, 3);
      for (let i = 0; i < budgetCount; i++) {
        const budget = await prisma.budget.create({
          data: {
            tenantId: tenant.id,
            departmentId: dept.id,
            name: `${dept.name} ${randomElement(budgetCategories)} Budget`,
            code: `BGT-${dept.code}-${i + 1}`,
            amount: randomFloat(100000, 50000000),
            currency: randomElement(["USD", "EUR", "GBP"]),
            fiscalYear: randomInt(2023, 2025),
            category: randomElement(budgetCategories),
            isActive: true,
          },
        });
        createdBudgets.push(budget);
      }
    }
    console.log(`  ✓ Created ${createdBudgets.length} budgets`);

    // Create services
    const createdServices = [];
    for (let i = 0; i < 20; i++) {
      const dept = randomElement(createdDepartments);
      const service = await prisma.service.create({
        data: {
          tenantId: tenant.id,
          departmentId: dept.id,
          name: serviceNames[i % serviceNames.length],
          code: `SVC-${String(i + 1).padStart(3, "0")}`,
          description: `${serviceNames[i % serviceNames.length]} supporting business operations`,
          serviceType: randomElement(serviceTypes),
          status: randomElement(serviceStatuses),
          isActive: true,
        },
      });
      createdServices.push(service);
    }
    console.log(`  ✓ Created ${createdServices.length} services`);

    // Create KPIs
    const createdKPIs = [];
    for (let i = 0; i < 25; i++) {
      const dept = randomElement(createdDepartments);
      const targetValue = randomFloat(50, 100);
      const kpi = await prisma.kPI.create({
        data: {
          tenantId: tenant.id,
          departmentId: dept.id,
          name: kpiNames[i % kpiNames.length],
          code: `KPI-${String(i + 1).padStart(3, "0")}`,
          description: `Measures ${kpiNames[i % kpiNames.length].toLowerCase()} performance`,
          unit: randomElement(["%", "Count", "USD", "Days", "Score", "Hours"]),
          targetValue: targetValue,
          currentValue: randomFloat(targetValue * 0.7, targetValue * 1.1),
          measurementFrequency: randomElement(measurementFrequencies),
          isActive: true,
        },
      });
      createdKPIs.push(kpi);
    }
    console.log(`  ✓ Created ${createdKPIs.length} KPIs`);

    // Create regulations
    const createdRegulations = [];
    const regulationCount = randomInt(30, 50);
    for (let i = 0; i < regulationCount; i++) {
      const prefix = randomElement(regulationPrefixes);
      const suffix = randomElement(regulationSuffixes);
      const effectiveDate = randomDate(new Date(2022, 0, 1), new Date(2025, 11, 31));
      const expirationDate = Math.random() > 0.7 ? randomDate(effectiveDate, new Date(2028, 11, 31)) : null;

      const regulation = await prisma.regulation.create({
        data: {
          tenantId: tenant.id,
          departmentId: randomElement(createdDepartments).id,
          name: `${prefix} ${suffix}`,
          code: generateCode(prefix, i + 1),
          description: `Regulatory requirement for ${prefix.toLowerCase()} compliance in ${suffix.toLowerCase()} areas. This regulation mandates specific controls and reporting requirements.`,
          regulationType: randomElement(regulationTypes),
          effectiveDate: effectiveDate,
          expirationDate: expirationDate,
          status: randomElement(["Active", "Active", "Active", "Draft", "Superseded"]),
          severity: randomElement(severities),
          enforcementParams: {
            auditFrequency: randomElement(["Annual", "Quarterly", "Monthly"]),
            penaltyAmount: randomInt(10000, 1000000),
            requiresDocumentation: Math.random() > 0.3,
          },
          version: 1,
          isActive: true,
        },
      });
      createdRegulations.push(regulation);
    }
    console.log(`  ✓ Created ${createdRegulations.length} regulations`);

    // Create impact edges (dependency graph)
    const createdEdges = [];
    
    // Regulation -> Department edges
    for (const reg of createdRegulations.slice(0, 30)) {
      const targetDept = randomElement(createdDepartments);
      try {
        const edge = await prisma.impactEdge.create({
          data: {
            tenantId: tenant.id,
            sourceType: "REGULATION" as EntityType,
            sourceId: reg.id,
            targetType: "DEPARTMENT" as EntityType,
            targetId: targetDept.id,
            impactWeight: randomFloat(0.3, 1.0),
            impactType: randomElement(impactTypes),
            impactCategory: randomElement(impactCategories),
            description: `Regulation ${reg.code} impacts ${targetDept.name}`,
            isActive: true,
          },
        });
        createdEdges.push(edge);
      } catch (e) {
        // Skip duplicates
      }
    }

    // Department -> Budget edges
    for (const dept of createdDepartments) {
      const deptBudgets = createdBudgets.filter(b => b.departmentId === dept.id);
      for (const budget of deptBudgets.slice(0, 2)) {
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "DEPARTMENT" as EntityType,
              sourceId: dept.id,
              targetType: "BUDGET" as EntityType,
              targetId: budget.id,
              impactWeight: randomFloat(0.5, 1.0),
              impactType: "Direct",
              impactCategory: "Financial",
              description: `Department ${dept.name} budget impact`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    // Department -> Service edges
    for (const service of createdServices) {
      if (Math.random() > 0.3) {
        const sourceDept = randomElement(createdDepartments);
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "DEPARTMENT" as EntityType,
              sourceId: sourceDept.id,
              targetType: "SERVICE" as EntityType,
              targetId: service.id,
              impactWeight: randomFloat(0.2, 0.9),
              impactType: randomElement(impactTypes),
              impactCategory: "Operational",
              description: `Service dependency on ${sourceDept.name}`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    // Department -> KPI edges
    for (const kpi of createdKPIs) {
      if (Math.random() > 0.4) {
        const sourceDept = randomElement(createdDepartments);
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "DEPARTMENT" as EntityType,
              sourceId: sourceDept.id,
              targetType: "KPI" as EntityType,
              targetId: kpi.id,
              impactWeight: randomFloat(0.3, 0.8),
              impactType: randomElement(impactTypes),
              impactCategory: "Strategic",
              description: `KPI measurement for ${sourceDept.name}`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    // Service -> Service edges (dependencies)
    for (let i = 0; i < 15; i++) {
      const source = randomElement(createdServices);
      const target = randomElement(createdServices.filter(s => s.id !== source.id));
      if (target) {
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "SERVICE" as EntityType,
              sourceId: source.id,
              targetType: "SERVICE" as EntityType,
              targetId: target.id,
              impactWeight: randomFloat(0.4, 0.9),
              impactType: randomElement(["Direct", "Indirect"]),
              impactCategory: "Technical",
              description: `Service dependency: ${source.name} -> ${target.name}`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    // Budget -> KPI edges
    for (const kpi of createdKPIs.slice(0, 15)) {
      if (Math.random() > 0.5) {
        const budget = randomElement(createdBudgets);
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "BUDGET" as EntityType,
              sourceId: budget.id,
              targetType: "KPI" as EntityType,
              targetId: kpi.id,
              impactWeight: randomFloat(0.2, 0.7),
              impactType: "Indirect",
              impactCategory: "Financial",
              description: `Budget impact on KPI`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    // KPI -> KPI edges (cascading metrics)
    for (let i = 0; i < 10; i++) {
      const source = randomElement(createdKPIs);
      const target = randomElement(createdKPIs.filter(k => k.id !== source.id));
      if (target) {
        try {
          const edge = await prisma.impactEdge.create({
            data: {
              tenantId: tenant.id,
              sourceType: "KPI" as EntityType,
              sourceId: source.id,
              targetType: "KPI" as EntityType,
              targetId: target.id,
              impactWeight: randomFloat(0.3, 0.6),
              impactType: "Indirect",
              impactCategory: "Strategic",
              description: `KPI correlation`,
              isActive: true,
            },
          });
          createdEdges.push(edge);
        } catch (e) {
          // Skip duplicates
        }
      }
    }

    console.log(`  ✓ Created ${createdEdges.length} impact edges`);

    // Create simulations
    for (let i = 0; i < 5; i++) {
      const regulation = randomElement(createdRegulations);
      await prisma.simulation.create({
        data: {
          tenantId: tenant.id,
          regulationId: regulation.id,
          name: `Impact Analysis - ${regulation.code}`,
          description: `Simulation of ${regulation.name} impact on organizational entities`,
          simulationType: randomElement(["WhatIf", "Timeline", "Comparison"]),
          baselineDate: new Date(),
          targetDate: randomDate(new Date(), new Date(2025, 11, 31)),
          parameters: { scenario: randomElement(["optimistic", "pessimistic", "realistic"]) },
          status: randomElement(["Completed", "Pending", "Running", "Failed"]),
          results: { 
            affectedEntities: randomInt(10, 100),
            estimatedCost: randomFloat(50000, 500000),
            timeline: `${randomInt(1, 12)} months`
          },
        },
      });
    }
    console.log(`  ✓ Created simulations`);

    // Create audit logs
    const actions = ["CREATE", "UPDATE", "DELETE", "PROPAGATE", "SIMULATE"];
    for (let i = 0; i < 50; i++) {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          entityType: randomElement(["Regulation", "Department", "Budget", "Service", "KPI", "ImpactEdge"]),
          entityId: randomElement([...createdRegulations, ...createdDepartments, ...createdServices]).id,
          action: randomElement(actions),
          userName: randomElement(["Admin", "Compliance Officer", "Risk Manager", "System"]),
          ipAddress: `192.168.${randomInt(1, 255)}.${randomInt(1, 255)}`,
          metadata: { browser: "Chrome", os: "Windows" },
        },
      });
    }
    console.log(`  ✓ Created audit logs`);
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("🎉 Seeding completed!");
  console.log("=".repeat(50));
  
  const summary = await Promise.all([
    prisma.tenant.count(),
    prisma.department.count(),
    prisma.budget.count(),
    prisma.service.count(),
    prisma.kPI.count(),
    prisma.regulation.count(),
    prisma.impactEdge.count(),
    prisma.simulation.count(),
    prisma.auditLog.count(),
  ]);

  console.log(`
📊 Summary:
  - Tenants:       ${summary[0]}
  - Departments:   ${summary[1]}
  - Budgets:       ${summary[2]}
  - Services:      ${summary[3]}
  - KPIs:          ${summary[4]}
  - Regulations:   ${summary[5]}
  - Impact Edges:  ${summary[6]}
  - Simulations:   ${summary[7]}
  - Audit Logs:    ${summary[8]}
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
