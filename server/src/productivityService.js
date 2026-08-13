import { one, query } from './db.js';
import {
  buildProductivityInsights,
  calculateProductivityTat,
  calculateRevenueCredit,
  calculateTargetPace,
  calculateUtilization,
  currentPeriodRange,
  daysBetweenInclusive,
  getUtilizationStatus,
  getTrackingEnd,
  getTrackingStart,
  growthPercent,
  money,
  reportRanges,
  resolvePeriodRange,
  weeksBetween
} from './productivityCalculations.js';

export const productivityResponsibilities = [
  ['strategy', 'Strategy'],
  ['cs', 'CS'],
  ['website', 'Website'],
  ['design', 'Design'],
  ['copy', 'Copy / Content'],
  ['edit', 'Edit'],
  ['shoot', 'Shoot'],
  ['seo', 'SEO'],
  ['smo', 'SMO'],
  ['qc', 'Quality Check']
];

export const productivityServiceSeeds = [
  ['Website full build', 80],
  ['Connector Apps / Small Web Additions', 18],
  ['Social Media Optimisation', 16],
  ['Design', 10],
  ['Standees / Backdrops / Advertisements', 12],
  ['Films & Edits', 30],
  ['Animation / Motion Graphics', 36],
  ['Reels & Shorts', 8],
  ['Podcasts', 14],
  ['Strategy & Presentations', 16],
  ['Business Development', 10],
  ['Paper Advertisement Design', 10],
  ['Other Design Interventions', 12],
  ['Photography / Filming', 24]
];

const statusLabels = {
  overworked: 'Overworked',
  stretched: 'Stretched',
  balanced: 'Balanced',
  underutilised: 'Underutilised',
  idle: 'Idle'
};
const emptyRangeParams = range => [range.from, range.to];
const number = value => Number(value || 0);
const round = value => Math.round(number(value) * 100) / 100;
const statusForDifficulty = difficulty => {
  const value = Number(difficulty || 0);
  if (value >= 9)
    return 'red';
  if (value >= 7)
    return 'amber';
  if (value >= 4)
    return 'blue';
  return 'green';
};

export function resolveProductivityPeriod(queryParams = {}) {
  return resolvePeriodRange(queryParams.period || 'all', queryParams.from, queryParams.to);
}

export function validateProductivityDates({ startDate, completionDate }) {
  const range = resolvePeriodRange('all');
  if (!startDate || startDate < range.trackingStart || startDate > range.trackingEnd)
    return `Start date must be inside the tracking window ${range.trackingStart} to ${range.trackingEnd}`;
  if (completionDate) {
    if (completionDate < startDate)
      return 'Completion date cannot be before start date';
    if (completionDate > range.trackingEnd)
      return `Completion date must be on or before ${range.trackingEnd}`;
  }
  return '';
}

export async function seedProductivityServicesIfEmpty(connection) {
  const existing = await one('SELECT COUNT(*) count FROM productivity_services', [], connection);
  if (Number(existing?.count || 0))
    return;
  for (const [name, referenceHours] of productivityServiceSeeds) {
    await query('INSERT INTO productivity_services (name,reference_hours,is_active) VALUES (?,?,1)', [name, referenceHours], connection);
  }
}

export async function loadProductivityEmployees(connection) {
  return query(`SELECT u.id,u.name,u.email,u.status,COALESCE(u.account_type,u.role) accountType,
      d.name departmentName,ds.name designationName,ds.hierarchy_level designationLevel,
      COALESCE(pes.weekly_capacity_hours,40) weeklyCapacityHours,
      COALESCE(pes.productivity_status,'active') productivityStatus
    FROM users u
    LEFT JOIN departments d ON d.id=u.department_id
    LEFT JOIN designations ds ON ds.id=u.designation_id
    LEFT JOIN productivity_employee_settings pes ON pes.user_id=u.id
    WHERE COALESCE(u.account_type,u.role)<>'client'
    ORDER BY u.name`, [], connection);
}

export async function productivityMeta(user, connection) {
  const [employees, services, clients] = await Promise.all([
    loadProductivityEmployees(connection),
    query('SELECT id,name,reference_hours referenceHours,is_active isActive FROM productivity_services ORDER BY is_active DESC,name', [], connection),
    query('SELECT id,name,status FROM clients ORDER BY name', [], connection)
  ]);
  return {
    tracking: { start: getTrackingStart(), end: getTrackingEnd() },
    responsibilities: productivityResponsibilities.map(([key, label]) => ({ key, label })),
    employees: employees.map(mapEmployee),
    services: services.map(row => ({ ...row, id: String(row.id), referenceHours: number(row.referenceHours), isActive: Boolean(row.isActive) })),
    clients
  };
}

const mapEmployee = row => ({
  id: row.id,
  name: row.name,
  email: row.email,
  status: row.status,
  accountType: row.accountType,
  departmentName: row.departmentName || '',
  designationName: row.designationName || '',
  designationLevel: row.designationLevel == null ? null : Number(row.designationLevel),
  weeklyCapacityHours: number(row.weeklyCapacityHours || 40),
  productivityStatus: row.productivityStatus || 'active',
  duties: [row.designationName, row.departmentName].filter(Boolean).join(' - ') || row.accountType
});

function mapJob(row) {
  return {
    id: String(row.id),
    coreJobId: row.coreJobId || null,
    clientId: row.clientId,
    clientName: row.clientName || row.clientId,
    startDate: row.startDate,
    completionDate: row.completionDate || null,
    status: row.completionDate ? 'Completed' : 'In Progress',
    productivityTat: calculateProductivityTat(row.startDate, row.completionDate),
    valueAmount: number(row.valueAmount),
    description: row.description || '',
    createdByUserId: row.createdByUserId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    services: [],
    assignments: []
  };
}

export async function loadProductivityJobs(range, { serviceId = '', userId = '', clientId = '' } = {}, connection) {
  const clauses = ['pj.start_date BETWEEN ? AND ?'];
  const params = emptyRangeParams(range);
  if (clientId) {
    clauses.push('pj.client_id=?');
    params.push(clientId);
  }
  const rows = await query(`SELECT pj.id,pj.core_job_id coreJobId,pj.client_id clientId,c.name clientName,
      pj.start_date startDate,pj.completion_date completionDate,pj.value_amount valueAmount,
      pj.description,pj.created_by_user_id createdByUserId,pj.created_at createdAt,pj.updated_at updatedAt
    FROM productivity_jobs pj
    JOIN clients c ON c.id=pj.client_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY pj.start_date DESC,pj.id DESC`, params, connection);
  if (!rows.length)
    return [];
  const jobs = rows.map(mapJob);
  const ids = jobs.map(job => job.id);
  const placeholders = ids.map(() => '?').join(',');
  const [serviceRows, assignmentRows] = await Promise.all([
    query(`SELECT pjs.productivity_job_id jobId,s.id serviceId,s.name,s.reference_hours referenceHours
      FROM productivity_job_services pjs
      JOIN productivity_services s ON s.id=pjs.service_id
      WHERE pjs.productivity_job_id IN (${placeholders})
      ORDER BY s.name`, ids, connection),
    query(`SELECT pja.id,pja.productivity_job_id jobId,pja.user_id userId,u.name userName,
      pja.responsibility_key responsibilityKey,
        d.name departmentName,ds.name designationName,
        pja.revenue_percent revenuePercent,pja.hours_spent hoursSpent
      FROM productivity_job_assignments pja
      JOIN users u ON u.id=pja.user_id
      LEFT JOIN departments d ON d.id=u.department_id
      LEFT JOIN designations ds ON ds.id=u.designation_id
      WHERE pja.productivity_job_id IN (${placeholders})
      ORDER BY u.name`, ids, connection)
  ]);
  const byId = new Map(jobs.map(job => [job.id, job]));
  for (const row of serviceRows) {
    byId.get(String(row.jobId))?.services.push({
      id: String(row.serviceId),
      name: row.name,
      referenceHours: number(row.referenceHours)
    });
  }
  for (const row of assignmentRows) {
    byId.get(String(row.jobId))?.assignments.push({
      id: String(row.id),
      jobId: String(row.jobId),
      userId: row.userId,
      userName: row.userName,
      responsibilityKey: row.responsibilityKey || '',
      departmentName: row.departmentName || '',
      designationName: row.designationName || '',
      revenuePercent: number(row.revenuePercent),
      hoursSpent: number(row.hoursSpent),
      revenueCredit: 0
    });
  }
  for (const job of jobs) {
    for (const assignment of job.assignments)
      assignment.revenueCredit = money(calculateRevenueCredit(job.valueAmount, assignment.revenuePercent));
    job.totalHours = round(job.assignments.reduce((sum, item) => sum + item.hoursSpent, 0));
    job.serviceNames = job.services.map(service => service.name).join(', ');
  }
  return jobs.filter(job => (!serviceId || job.services.some(service => String(service.id) === String(serviceId)))
    && (!userId || job.assignments.some(assignment => assignment.userId === userId)));
}

function summarizePeople(employees, jobs, range, rosterLoad = [], salaryMap = null) {
  const weeks = weeksBetween(range.from, range.to);
  const byUser = new Map(employees.map(employee => [employee.id, {
    ...employee,
    hours: 0,
    revenueCredit: 0,
    jobs: 0,
    accountCount: 0,
    difficultySum: 0,
    salaryGrade: null,
    efficiency: null
  }]));
  const jobSets = new Map();
  for (const job of jobs) {
    for (const assignment of job.assignments) {
      const person = byUser.get(assignment.userId);
      if (!person)
        continue;
      person.hours += assignment.hoursSpent;
      person.revenueCredit += assignment.revenueCredit;
      const set = jobSets.get(person.id) || new Set();
      set.add(job.id);
      jobSets.set(person.id, set);
    }
  }
  for (const load of rosterLoad) {
    const person = byUser.get(load.userId);
    if (person) {
      person.accountCount = load.accountCount;
      person.difficultySum = load.difficultySum;
    }
  }
  return [...byUser.values()].map(person => {
    const utilization = calculateUtilization(person.hours, person.weeklyCapacityHours || 40, weeks);
    const status = getUtilizationStatus(utilization);
    const salary = salaryMap?.get(person.id);
    const months = weeks / 4.345;
    const salaryCost = salary ? ((salary.minAmount + salary.maxAmount) / 2) * months : 0;
    return {
      ...person,
      hours: round(person.hours),
      revenueCredit: money(person.revenueCredit),
      jobs: jobSets.get(person.id)?.size || 0,
      capacityHours: round(number(person.weeklyCapacityHours || 40) * weeks),
      utilization: round(utilization),
      status,
      statusLabel: statusLabels[status],
      salaryGrade: salary?.label || null,
      efficiency: salaryCost ? round(person.revenueCredit / salaryCost) : null,
      recommendation: recommendationFor(status, person)
    };
  }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

const recommendationFor = (status, person) => {
  if (status === 'overworked')
    return 'Redistribute work or add backup support.';
  if (status === 'stretched')
    return 'Monitor workload and avoid adding critical accounts.';
  if (status === 'balanced')
    return 'Healthy allocation.';
  if (status === 'underutilised')
    return person.accountCount ? 'Assign more execution work from existing accounts.' : 'Add accounts or cross-train.';
  return 'No activity logged; review assignment plan.';
};

function summarizeClients(jobs) {
  const map = new Map();
  const totalRevenue = jobs.reduce((sum, job) => sum + job.valueAmount, 0);
  for (const job of jobs) {
    const item = map.get(job.clientId) || {
      clientId: job.clientId,
      clientName: job.clientName,
      revenue: 0,
      jobs: 0,
      hours: 0,
      people: new Set(),
      services: new Map()
    };
    item.revenue += job.valueAmount;
    item.jobs += 1;
    item.hours += job.totalHours || 0;
    for (const assignment of job.assignments)
      item.people.add(assignment.userId);
    for (const service of job.services)
      item.services.set(service.name, (item.services.get(service.name) || 0) + 1);
    map.set(job.clientId, item);
  }
  return [...map.values()].map(item => ({
    clientId: item.clientId,
    clientName: item.clientName,
    revenue: money(item.revenue),
    jobs: item.jobs,
    hours: round(item.hours),
    peopleInvolved: item.people.size,
    servicesUsed: [...item.services.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    percent: totalRevenue ? round(item.revenue / totalRevenue * 100) : 0
  })).sort((a, b) => b.revenue - a.revenue || a.clientName.localeCompare(b.clientName));
}

function summarizeServices(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const serviceCount = Math.max(job.services.length, 1);
    const revenueShare = job.valueAmount / serviceCount;
    const hoursShare = number(job.totalHours) / serviceCount;
    for (const service of job.services) {
      const item = map.get(service.id) || {
        serviceId: service.id,
        name: service.name,
        revenue: 0,
        hours: 0,
        jobs: 0,
        contributors: new Set()
      };
      item.revenue += revenueShare;
      item.hours += hoursShare;
      item.jobs += 1;
      for (const assignment of job.assignments)
        item.contributors.add(assignment.userId);
      map.set(service.id, item);
    }
  }
  return [...map.values()].map(item => ({
    serviceId: item.serviceId,
    name: item.name,
    revenue: money(item.revenue),
    hours: round(item.hours),
    jobs: item.jobs,
    revenuePerHour: item.hours ? money(item.revenue / item.hours) : 0,
    contributors: [...item.contributors]
  })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

function dailyLog(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const row = map.get(job.startDate) || { date: job.startDate, jobs: 0, totalHours: 0, people: new Map() };
    row.jobs += 1;
    row.totalHours += job.totalHours || 0;
    for (const assignment of job.assignments) {
      const current = row.people.get(assignment.userId) || { userId: assignment.userId, name: assignment.userName, hours: 0 };
      current.hours += assignment.hoursSpent;
      row.people.set(assignment.userId, current);
    }
    map.set(job.startDate, row);
  }
  return [...map.values()].map(row => ({
    date: row.date,
    jobs: row.jobs,
    totalHours: round(row.totalHours),
    people: [...row.people.values()].map(person => ({ ...person, hours: round(person.hours) })).sort((a, b) => b.hours - a.hours)
  })).sort((a, b) => b.date.localeCompare(a.date));
}

function monthlyTrend(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const key = job.startDate.slice(0, 7);
    const row = map.get(key) || { month: key, jobs: 0, revenue: 0, hours: 0 };
    row.jobs += 1;
    row.revenue += job.valueAmount;
    row.hours += job.totalHours || 0;
    map.set(key, row);
  }
  return [...map.values()].map(row => ({ ...row, revenue: money(row.revenue), hours: round(row.hours) })).sort((a, b) => a.month.localeCompare(b.month));
}

async function rosterStats(connection) {
  const rows = await query(`SELECT pra.user_id userId,u.name,pra.roster_id rosterId,pr.difficulty
    FROM productivity_account_roster_assignments pra
    JOIN productivity_account_rosters pr ON pr.id=pra.roster_id
    JOIN users u ON u.id=pra.user_id
    WHERE pra.assignee_type='employee' AND pra.user_id IS NOT NULL`, [], connection);
  const map = new Map();
  for (const row of rows) {
    const item = map.get(row.userId) || { userId: row.userId, name: row.name, accounts: new Set(), difficultySum: 0 };
    if (!item.accounts.has(String(row.rosterId))) {
      item.accounts.add(String(row.rosterId));
      item.difficultySum += Number(row.difficulty || 0);
    }
    map.set(row.userId, item);
  }
  return [...map.values()].map(item => ({ userId: item.userId, name: item.name, accountCount: item.accounts.size, difficultySum: item.difficultySum }))
    .sort((a, b) => b.difficultySum - a.difficultySum || b.accountCount - a.accountCount);
}

async function salaryMapForOwner(ownerId, connection) {
  const rows = await query(`SELECT psa.employee_user_id userId,psg.label,psg.min_amount minAmount,psg.max_amount maxAmount
    FROM productivity_salary_assignments psa
    JOIN productivity_salary_grades psg ON psg.id=psa.grade_id AND psg.owner_user_id=psa.owner_user_id
    WHERE psa.owner_user_id=?`, [ownerId], connection);
  return new Map(rows.map(row => [row.userId, { label: row.label, minAmount: number(row.minAmount), maxAmount: number(row.maxAmount) }]));
}

export async function getDashboard({ range, connection }) {
  const [employees, jobs, rosterLoad] = await Promise.all([
    loadProductivityEmployees(connection),
    loadProductivityJobs(range, {}, connection),
    rosterStats(connection)
  ]);
  const people = summarizePeople(employees.map(mapEmployee), jobs, range, rosterLoad);
  const clients = summarizeClients(jobs);
  const services = summarizeServices(jobs);
  const hoursLogged = round(jobs.reduce((sum, job) => sum + (job.totalHours || 0), 0));
  return {
    period: range,
    kpis: {
      revenueTracked: money(jobs.reduce((sum, job) => sum + job.valueAmount, 0)),
      jobsLogged: jobs.length,
      hoursLogged,
      activeClients: clients.length,
      totalClients: Number((await one("SELECT COUNT(*) count FROM clients WHERE status='active'", [], connection))?.count || 0),
      overworked: people.filter(person => person.utilization >= 115).length,
      underused: people.filter(person => person.utilization < 55).length
    },
    revenueByClient: clients.slice(0, 8),
    revenueByService: services.slice(0, 8),
    teamLoad: people,
    insights: buildProductivityInsights({ people, services, rosterLoad, clientConcentration: clients })
  };
}

export async function getAnalysis({ connection }) {
  const range = resolvePeriodRange('custom', getTrackingStart(), getTrackingEnd());
  const [employees, jobs, rosterLoad] = await Promise.all([
    loadProductivityEmployees(connection),
    loadProductivityJobs(range, {}, connection),
    rosterStats(connection)
  ]);
  const people = summarizePeople(employees.map(mapEmployee), jobs, range, rosterLoad);
  const services = summarizeServices(jobs);
  const clients = summarizeClients(jobs);
  const today = new Date(`${range.to}T00:00:00.000Z`);
  const last30 = resolvePeriodRange('last30', '', '', today);
  const priorTo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const priorFrom = new Date(today.getTime() - 59 * 24 * 60 * 60 * 1000);
  const inRange = (job, target) => job.startDate >= target.from && job.startDate <= target.to;
  const currentJobs = jobs.filter(job => inRange(job, last30));
  const priorRange = { from: priorFrom.toISOString().slice(0, 10), to: priorTo.toISOString().slice(0, 10) };
  const priorJobs = jobs.filter(job => inRange(job, priorRange));
  const revenue = list => list.reduce((sum, job) => sum + job.valueAmount, 0);
  const hours = list => list.reduce((sum, job) => sum + (job.totalHours || 0), 0);
  return {
    period: range,
    trajectory: {
      totalRevenue: money(revenue(jobs)),
      totalHours: round(hours(jobs)),
      revenueLast30: money(revenue(currentJobs)),
      revenuePrior30: money(revenue(priorJobs)),
      revenueGrowth: round(growthPercent(revenue(currentJobs), revenue(priorJobs))),
      effortLast30: round(hours(currentJobs)),
      effortPrior30: round(hours(priorJobs)),
      effortGrowth: round(growthPercent(hours(currentJobs), hours(priorJobs)))
    },
    monthlyTrend: monthlyTrend(jobs),
    workforceRoadmap: people,
    serviceRevenuePerHour: services.filter(service => service.hours > 0).sort((a, b) => b.revenuePerHour - a.revenuePerHour),
    personRevenuePerHour: people.filter(person => person.hours > 0).map(person => ({ ...person, revenuePerHour: money(person.revenueCredit / person.hours) })).sort((a, b) => b.revenuePerHour - a.revenuePerHour),
    clientConcentration: clients,
    insights: buildProductivityInsights({ people, services, rosterLoad, clientConcentration: clients })
  };
}

export async function getByPerson({ range, ownerId = '', includeSalary = false, connection }) {
  const [employees, jobs, rosterLoad] = await Promise.all([
    loadProductivityEmployees(connection),
    loadProductivityJobs(range, {}, connection),
    rosterStats(connection)
  ]);
  const salary = includeSalary && ownerId ? await salaryMapForOwner(ownerId, connection) : null;
  return { period: range, people: summarizePeople(employees.map(mapEmployee), jobs, range, rosterLoad, salary) };
}

export async function getByClient({ range, connection }) {
  const jobs = await loadProductivityJobs(range, {}, connection);
  return { period: range, clients: summarizeClients(jobs) };
}

export async function getDailyLog({ range, connection }) {
  const jobs = await loadProductivityJobs(range, {}, connection);
  return { period: range, days: dailyLog(jobs) };
}

export async function getAllJobs({ range, connection }) {
  const jobs = await loadProductivityJobs(range, {}, connection);
  return { period: range, jobs };
}

export async function getReports({ serviceId = '', connection }) {
  const ranges = reportRanges();
  const [clients, employees] = await Promise.all([
    query('SELECT id,name FROM clients ORDER BY name', [], connection),
    loadProductivityEmployees(connection)
  ]);
  const build = async (range) => loadProductivityJobs(range, { serviceId }, connection);
  const entries = {};
  for (const [key, range] of Object.entries(ranges))
    entries[key] = await build(range);
  const byClient = clients.map(client => {
    const row = { clientId: client.id, clientName: client.name };
    for (const [key, jobs] of Object.entries(entries)) {
      const list = jobs.filter(job => job.clientId === client.id);
      row[key] = { jobs: list.length, hours: round(list.reduce((sum, job) => sum + (job.totalHours || 0), 0)) };
    }
    return row;
  });
  const byPerson = employees.map(mapEmployee).map(person => {
    const row = { userId: person.id, name: person.name, duties: person.duties };
    for (const [key, jobs] of Object.entries(entries)) {
      const assignments = jobs.flatMap(job => job.assignments.filter(assignment => assignment.userId === person.id));
      row[key] = { jobs: new Set(assignments.map(assignment => assignment.jobId)).size, hours: round(assignments.reduce((sum, item) => sum + item.hoursSpent, 0)) };
    }
    return row;
  });
  return { ranges, byClient, byPerson };
}

export async function getAccounts({ range, connection }) {
  const rosters = await query(`SELECT pr.id,pr.client_id clientId,c.name clientName,pr.nature,pr.difficulty,pr.comments,pr.created_at createdAt,pr.updated_at updatedAt
    FROM productivity_account_rosters pr
    JOIN clients c ON c.id=pr.client_id
    ORDER BY FIELD(pr.nature,'Existing','Prospect'),pr.difficulty DESC,c.name`, [], connection);
  const ids = rosters.map(row => row.id);
  const assignments = ids.length ? await query(`SELECT pra.id,pra.roster_id rosterId,pra.responsibility_key responsibilityKey,
      pra.assignee_type assigneeType,pra.user_id userId,u.name userName,pra.external_name externalName
    FROM productivity_account_roster_assignments pra
    LEFT JOIN users u ON u.id=pra.user_id
    WHERE pra.roster_id IN (${ids.map(() => '?').join(',')})
    ORDER BY pra.responsibility_key,u.name,pra.external_name`, ids, connection) : [];
  const grouped = assignments.reduce((map, row) => {
    const list = map.get(String(row.rosterId)) || [];
    list.push(row);
    map.set(String(row.rosterId), list);
    return map;
  }, new Map());
  const dashboard = await getDashboard({ range, connection });
  const utilByUser = new Map(dashboard.teamLoad.map(person => [person.id, person]));
  const load = (await rosterStats(connection)).map(item => ({ ...item, utilization: utilByUser.get(item.userId)?.utilization || 0, status: utilByUser.get(item.userId)?.status || 'idle' }));
  return {
    rosters: rosters.map(row => {
      const byResponsibility = {};
      for (const [key] of productivityResponsibilities)
        byResponsibility[key] = [];
      for (const assignment of grouped.get(String(row.id)) || []) {
        byResponsibility[assignment.responsibilityKey] = [...(byResponsibility[assignment.responsibilityKey] || []), {
          id: String(assignment.id),
          assigneeType: assignment.assigneeType,
          userId: assignment.userId || '',
          userName: assignment.userName || '',
          externalName: assignment.externalName || ''
        }];
      }
      return { ...row, id: String(row.id), difficulty: Number(row.difficulty), difficultyTone: statusForDifficulty(row.difficulty), assignments: byResponsibility };
    }),
    accountLoad: load
  };
}

export async function getTargets({ connection }) {
  const rows = await query(`SELECT pt.id,pt.user_id userId,u.name userName,pt.service_id serviceId,s.name serviceName,
      pt.quantity,pt.unit,pt.period,pt.is_active isActive,pt.created_at createdAt,pt.updated_at updatedAt
    FROM productivity_targets pt
    JOIN users u ON u.id=pt.user_id
    JOIN productivity_services s ON s.id=pt.service_id
    ORDER BY pt.is_active DESC,u.name,s.name`, [], connection);
  const targets = [];
  for (const row of rows) {
    const range = currentPeriodRange(row.period);
    const jobs = await loadProductivityJobs(range, { serviceId: row.serviceId, userId: row.userId }, connection);
    const assignments = jobs.flatMap(job => job.assignments.filter(assignment => assignment.userId === row.userId));
    const actual = row.unit === 'hours'
      ? round(assignments.reduce((sum, assignment) => sum + assignment.hoursSpent, 0))
      : new Set(assignments.map(assignment => assignment.jobId)).size;
    targets.push({
      ...row,
      id: String(row.id),
      serviceId: String(row.serviceId),
      quantity: number(row.quantity),
      isActive: Boolean(row.isActive),
      actual,
      pace: calculateTargetPace(actual, row.quantity),
      currentRange: range
    });
  }
  return { targets };
}

export async function createOrUpdateProductivityJob(rule, actorId, connection) {
  let id = rule.id ? Number(rule.id) : 0;
  if (id) {
    await query(`UPDATE productivity_jobs SET core_job_id=?,client_id=?,start_date=?,completion_date=?,value_amount=?,description=? WHERE id=?`,
      [rule.coreJobId || null, rule.clientId, rule.startDate, rule.completionDate || null, rule.valueAmount, rule.description || '', id], connection);
    await query('DELETE FROM productivity_job_services WHERE productivity_job_id=?', [id], connection);
    await query('DELETE FROM productivity_job_assignments WHERE productivity_job_id=?', [id], connection);
  } else {
    const result = await query(`INSERT INTO productivity_jobs (core_job_id,client_id,start_date,completion_date,value_amount,description,created_by_user_id)
      VALUES (?,?,?,?,?,?,?)`, [rule.coreJobId || null, rule.clientId, rule.startDate, rule.completionDate || null, rule.valueAmount, rule.description || '', actorId], connection);
    id = Number(result.insertId);
  }
  for (const serviceId of rule.serviceIds)
    await query('INSERT IGNORE INTO productivity_job_services (productivity_job_id,service_id) VALUES (?,?)', [id, serviceId], connection);
  for (const assignment of rule.assignments) {
    await query(`INSERT INTO productivity_job_assignments (productivity_job_id,user_id,responsibility_key,revenue_percent,hours_spent)
      VALUES (?,?,?,?,?)`, [id, assignment.userId, assignment.responsibilityKey || null, assignment.revenuePercent, assignment.hoursSpent], connection);
  }
  return (await loadProductivityJobs(resolvePeriodRange('all'), {}, connection)).find(job => Number(job.id) === Number(id));
}

export async function deleteProductivityJob(id, connection) {
  await query('DELETE FROM productivity_jobs WHERE id=?', [id], connection);
}

export async function saveRoster(input, connection) {
  let id = input.id ? Number(input.id) : 0;
  let wasUpdate = Boolean(id);
  if (!id) {
    const existing = await one('SELECT id FROM productivity_account_rosters WHERE client_id=?', [input.clientId], connection);
    if (existing?.id) {
      id = Number(existing.id);
      wasUpdate = true;
    }
  }
  if (id) {
    await query('UPDATE productivity_account_rosters SET client_id=?,nature=?,difficulty=?,comments=? WHERE id=?',
      [input.clientId, input.nature, input.difficulty, input.comments || '', id], connection);
    await query('DELETE FROM productivity_account_roster_assignments WHERE roster_id=?', [id], connection);
  } else {
    const result = await query('INSERT INTO productivity_account_rosters (client_id,nature,difficulty,comments) VALUES (?,?,?,?)',
      [input.clientId, input.nature, input.difficulty, input.comments || ''], connection);
    id = Number(result.insertId);
  }
  for (const assignment of input.assignments) {
    await query(`INSERT INTO productivity_account_roster_assignments
      (roster_id,responsibility_key,assignee_type,user_id,external_name) VALUES (?,?,?,?,?)`,
      [id, assignment.responsibilityKey, assignment.assigneeType, assignment.userId || null, assignment.externalName || null], connection);
  }
  return { id, wasUpdate };
}

export async function reassignRosterAccounts({ fromUserId, toUserId, markInactive = false }, connection) {
  const rows = await query(`SELECT pra.id,pr.client_id clientId,c.name clientName,pra.responsibility_key responsibilityKey
    FROM productivity_account_roster_assignments pra
    JOIN productivity_account_rosters pr ON pr.id=pra.roster_id
    JOIN clients c ON c.id=pr.client_id
    WHERE pra.assignee_type='employee' AND pra.user_id=?`, [fromUserId], connection);
  await query(`UPDATE productivity_account_roster_assignments SET user_id=? WHERE assignee_type='employee' AND user_id=?`, [toUserId, fromUserId], connection);
  if (markInactive)
    await query(`INSERT INTO productivity_employee_settings (user_id,productivity_status)
      VALUES (?,'inactive')
      ON DUPLICATE KEY UPDATE productivity_status='inactive'`, [fromUserId], connection);
  return rows;
}

export async function saveTarget(input, actorId, connection) {
  if (input.id) {
    await query('UPDATE productivity_targets SET user_id=?,service_id=?,quantity=?,unit=?,period=?,is_active=? WHERE id=?',
      [input.userId, input.serviceId, input.quantity, input.unit, input.period, input.isActive ? 1 : 0, input.id], connection);
    return input.id;
  }
  const result = await query(`INSERT INTO productivity_targets (user_id,service_id,quantity,unit,period,is_active,created_by_user_id)
    VALUES (?,?,?,?,?,?,?)`, [input.userId, input.serviceId, input.quantity, input.unit, input.period, input.isActive ? 1 : 0, actorId], connection);
  return result.insertId;
}

export async function salaryGradesForOwner(ownerId, connection) {
  const count = await one('SELECT COUNT(*) count FROM productivity_salary_grades WHERE owner_user_id=?', [ownerId], connection);
  if (!Number(count?.count || 0)) {
    for (const [label, min, max] of [['Grade A', 0, 25000], ['Grade B', 25000, 45000], ['Grade C', 45000, 75000], ['Grade D', 75000, 125000], ['Grade E', 125000, 200000]])
      await query('INSERT INTO productivity_salary_grades (owner_user_id,label,min_amount,max_amount) VALUES (?,?,?,?)', [ownerId, label, min, max], connection);
  }
  const [grades, assignments] = await Promise.all([
    query('SELECT id,label,min_amount minAmount,max_amount maxAmount FROM productivity_salary_grades WHERE owner_user_id=? ORDER BY min_amount,label', [ownerId], connection),
    query(`SELECT psa.employee_user_id employeeUserId,psa.grade_id gradeId,u.name employeeName
      FROM productivity_salary_assignments psa
      JOIN users u ON u.id=psa.employee_user_id
      WHERE psa.owner_user_id=?`, [ownerId], connection)
  ]);
  return {
    grades: grades.map(row => ({ ...row, id: String(row.id), minAmount: number(row.minAmount), maxAmount: number(row.maxAmount) })),
    assignments: assignments.map(row => ({ ...row, gradeId: String(row.gradeId) }))
  };
}
