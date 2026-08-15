/**
 * Productivity Intelligence — Core Business Calculations & Insight Engine
 */

export function calculateUtilization(hours = 0, weeklyCapacity = 40, weeks = 1) {
  const capacityHours = Number(weeklyCapacity || 40) * Number(weeks || 1);
  if (!capacityHours || capacityHours <= 0) return 0;
  return Number(((Number(hours || 0) / capacityHours) * 100).toFixed(1));
}

export function getUtilizationStatus(utilization = 0) {
  const u = Number(utilization || 0);
  if (u >= 115) return 'overworked';
  if (u >= 90) return 'stretched';
  if (u >= 55) return 'balanced';
  if (u >= 25) return 'underutilised';
  return 'idle';
}

export function getUtilizationLabel(status) {
  switch (status) {
    case 'overworked': return 'Overworked';
    case 'stretched': return 'Stretched';
    case 'balanced': return 'Balanced';
    case 'underutilised': return 'Underutilised';
    case 'idle': return 'Idle';
    default: return 'Balanced';
  }
}

export function calculateRevenueCredit(jobValue = 0, percent = 100) {
  return Number(((Number(jobValue || 0) * Number(percent || 100)) / 100).toFixed(2));
}

export function calculateProductivityTat(startDate, completionDate) {
  if (!completionDate || !startDate) return null;
  const start = new Date(startDate);
  const end = new Date(completionDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  return Math.max(0, diffDays);
}

export function calculateTargetPace(actual = 0, target = 0) {
  const t = Number(target || 0);
  const a = Number(actual || 0);
  if (!t || t <= 0) return 'off_pace';
  const ratio = a / t;
  if (ratio >= 1.0) return 'on_pace';
  if (ratio >= 0.6) return 'behind';
  return 'off_pace';
}

export function calculateSalaryEfficiency(revenueCredit = 0, gradeMidpoint = 0, months = 1) {
  const cost = Number(gradeMidpoint || 0) * Number(months || 1);
  if (!cost || cost <= 0) return null;
  return Number((Number(revenueCredit || 0) / cost).toFixed(2));
}

/**
 * Generate automatic workload insights and roadmap signals
 */
export function buildProductivityInsights({ personStats = [], serviceStats = [], rosterStats = [], clientStats = [] }) {
  const insights = [];

  // 1. Overworked Employees (>= 115%)
  for (const person of personStats) {
    if (person.utilization >= 115) {
      insights.push({
        id: `overworked-${person.userId}`,
        type: 'overworked',
        severity: 'critical',
        userId: person.userId,
        title: `${person.name} is Overworked (${person.utilization}%)`,
        message: `${person.name} is running at ${person.utilization}% of capacity (${person.hours} hrs logged vs ${person.capacityHours} hrs capacity). Consider redistributing work, assigning backup support, or hiring in this area.`
      });
    }
  }

  // 2. Underutilised Employees (< 55% with some logged work)
  for (const person of personStats) {
    if (person.utilization > 0 && person.utilization < 55 && person.status === 'active') {
      insights.push({
        id: `underutilised-${person.userId}`,
        type: 'underutilised',
        severity: 'info',
        userId: person.userId,
        title: `${person.name} has Available Capacity (${person.utilization}%)`,
        message: `${person.name} is currently at ${person.utilization}% utilization. Can take on additional accounts, cross-training, or support overloaded peers.`
      });
    }
  }

  // 3. No Work Logged
  for (const person of personStats) {
    if (person.hours === 0 && person.status === 'active') {
      insights.push({
        id: `no-work-${person.userId}`,
        type: 'no_activity',
        severity: 'warning',
        userId: person.userId,
        title: `No Jobs Logged: ${person.name}`,
        message: `No productivity job effort has been recorded for ${person.name} during this selected reporting window.`
      });
    }
  }

  // 4. Single Point of Failure
  for (const svc of serviceStats) {
    if (svc.personCount === 1 && svc.primaryPerson) {
      const person = personStats.find(p => p.userId === svc.primaryPerson);
      if (person && (person.utilization >= 90)) {
        insights.push({
          id: `spof-${svc.serviceId}`,
          type: 'single_point_of_failure',
          severity: 'warning',
          serviceId: svc.serviceId,
          title: `Single Point of Failure: ${svc.name}`,
          message: `${svc.name} is handled entirely by ${person.name}, who is currently running at ${person.utilization}% load. Cross-train a secondary contributor to mitigate delivery risk.`
        });
      }
    }
  }

  // 5. Heavy Account Oversight Load
  for (const roster of rosterStats) {
    if (roster.accountCount >= 5 || roster.totalDifficulty >= 25) {
      insights.push({
        id: `oversight-${roster.userId}`,
        type: 'heavy_account_oversight',
        severity: 'warning',
        userId: roster.userId,
        title: `High Account Load: ${roster.name}`,
        message: `${roster.name} is assigned across ${roster.accountCount} accounts with a combined difficulty score of ${roster.totalDifficulty}. Monitor client delivery and delegation.`
      });
    }
  }

  // 6. Client Concentration Risk
  const totalRev = clientStats.reduce((acc, c) => acc + (Number(c.revenue) || 0), 0);
  if (totalRev > 0) {
    for (const client of clientStats) {
      const share = (Number(client.revenue || 0) / totalRev) * 100;
      if (share >= 40) {
        insights.push({
          id: `concentration-${client.clientId}`,
          type: 'client_concentration',
          severity: 'critical',
          clientId: client.clientId,
          title: `High Revenue Concentration: ${client.name} (${Math.round(share)}%)`,
          message: `${client.name} represents ${Math.round(share)}% of total logged revenue (₹${Number(client.revenue).toLocaleString('en-IN')}). Diversify account pipeline to manage revenue stability.`
        });
      }
    }
  }

  return insights;
}
