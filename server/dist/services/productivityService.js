import { pool, query, one, transaction, audit } from '../db.js';
import { resolvePeriodRange, getComparativeReportRanges, formatDateYMD, getTrackingStart, getTrackingEnd } from '../utils/productivityDates.js';
import {
  calculateUtilization,
  getUtilizationStatus,
  calculateRevenueCredit,
  calculateProductivityTat,
  calculateTargetPace,
  calculateSalaryEfficiency,
  buildProductivityInsights
} from './productivityCalculationService.js';

export class ProductivityService {
  /**
   * Main Dashboard Data Aggregation
   */
  static async getDashboard({ userContext, range }) {
    const from = range.from;
    const to = range.to;
    const weeks = range.weeks;

    // 1. Fetch active and total clients
    const clientRows = await query(`SELECT id, name, status FROM clients ORDER BY name ASC`);
    const totalClients = clientRows.length;
    const activeClients = clientRows.filter(c => c.status === 'active').length;

    // 2. Fetch productivity jobs within date range
    const jobs = await query(
      `SELECT j.*, c.name as client_name
       FROM productivity_jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.deleted_at IS NULL
         AND j.start_date >= ? AND j.start_date <= ?
       ORDER BY j.start_date DESC`,
      [from, to]
    );

    const jobIds = jobs.map(j => j.id);

    // 3. Fetch services and assignments for these jobs
    let jobServices = [];
    let jobAssignments = [];
    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      jobServices = await query(
        `SELECT js.productivity_job_id, s.id as service_id, s.name as service_name
         FROM productivity_job_services js
         JOIN productivity_services s ON s.id = js.service_id
         WHERE js.productivity_job_id IN (${placeholders})`,
        jobIds
      );

      jobAssignments = await query(
        `SELECT ja.*, u.name as user_name, u.email as user_email,
                er.name as external_name
         FROM productivity_job_assignments ja
         LEFT JOIN users u ON u.id = ja.user_id
         LEFT JOIN productivity_external_resources er ON er.id = ja.external_resource_id
         WHERE ja.productivity_job_id IN (${placeholders})`,
        jobIds
      );
    }

    // Attach services and assignments to jobs
    const servicesByJob = {};
    for (const s of jobServices) {
      if (!servicesByJob[s.productivity_job_id]) servicesByJob[s.productivity_job_id] = [];
      servicesByJob[s.productivity_job_id].push(s);
    }

    const assignmentsByJob = {};
    for (const a of jobAssignments) {
      if (!assignmentsByJob[a.productivity_job_id]) assignmentsByJob[a.productivity_job_id] = [];
      assignmentsByJob[a.productivity_job_id].push(a);
    }

    // 4. Calculate top KPIs
    let revenueTracked = 0;
    let hoursLogged = 0;
    const clientsWithJobs = new Set();

    for (const j of jobs) {
      const val = Number(j.value_amount || 0);
      revenueTracked += val;
      clientsWithJobs.add(j.client_id);
    }

    for (const a of jobAssignments) {
      hoursLogged += Number(a.hours_spent || 0);
    }

    // 5. Calculate Revenue by Client
    const clientRevenueMap = {};
    for (const c of clientRows) {
      clientRevenueMap[c.id] = { clientId: c.id, name: c.name, revenue: 0, jobCount: 0 };
    }
    for (const j of jobs) {
      if (clientRevenueMap[j.client_id]) {
        clientRevenueMap[j.client_id].revenue += Number(j.value_amount || 0);
        clientRevenueMap[j.client_id].jobCount += 1;
      }
    }
    const revenueByClient = Object.values(clientRevenueMap)
      .filter(c => c.revenue > 0 || c.jobCount > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // 6. Calculate Revenue by Service
    const serviceRevenueMap = {};
    const allServices = await query(`SELECT id, name FROM productivity_services WHERE is_active=1 ORDER BY name ASC`);
    for (const s of allServices) {
      serviceRevenueMap[s.id] = { serviceId: s.id, name: s.name, revenue: 0, hours: 0, count: 0, personIds: new Set() };
    }

    for (const j of jobs) {
      const svcs = servicesByJob[j.id] || [];
      const asgns = assignmentsByJob[j.id] || [];
      if (svcs.length > 0) {
        const revShare = Number(j.value_amount || 0) / svcs.length;
        const totalJobHours = asgns.reduce((sum, a) => sum + Number(a.hours_spent || 0), 0);
        const hoursShare = totalJobHours / svcs.length;

        for (const s of svcs) {
          if (!serviceRevenueMap[s.service_id]) {
            serviceRevenueMap[s.service_id] = { serviceId: s.service_id, name: s.service_name, revenue: 0, hours: 0, count: 0, personIds: new Set() };
          }
          serviceRevenueMap[s.service_id].revenue += revShare;
          serviceRevenueMap[s.service_id].hours += hoursShare;
          serviceRevenueMap[s.service_id].count += 1;
          for (const a of asgns) {
            if (a.user_id) serviceRevenueMap[s.service_id].personIds.add(a.user_id);
          }
        }
      }
    }

    const revenueByService = Object.values(serviceRevenueMap)
      .map(s => ({
        ...s,
        personCount: s.personIds.size,
        primaryPerson: s.personIds.size === 1 ? Array.from(s.personIds)[0] : null,
        personIds: undefined
      }))
      .filter(s => s.revenue > 0 || s.hours > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // 7. Calculate Team Load & Person Utilization
    const employees = await query(
      `SELECT u.id, u.name, u.email, u.role, u.account_type,
              d.name as department_name, ds.name as designation_name,
              COALESCE(pes.weekly_capacity_hours, 40.00) as weekly_capacity_hours,
              COALESCE(pes.productivity_status, 'active') as productivity_status
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN designations ds ON ds.id = u.designation_id
       LEFT JOIN productivity_employee_settings pes ON pes.user_id = u.id
       WHERE u.status = 'active'
         AND u.account_type IN ('employee', 'admin', 'super_admin')
       ORDER BY u.name ASC`
    );

    const personHoursMap = {};
    const personRevenueMap = {};
    const personJobsMap = {};

    for (const a of jobAssignments) {
      if (a.user_id) {
        personHoursMap[a.user_id] = (personHoursMap[a.user_id] || 0) + Number(a.hours_spent || 0);
        const job = jobs.find(j => j.id === a.productivity_job_id);
        if (job) {
          const credit = calculateRevenueCredit(job.value_amount, a.revenue_percent);
          personRevenueMap[a.user_id] = (personRevenueMap[a.user_id] || 0) + credit;
          personJobsMap[a.user_id] = (personJobsMap[a.user_id] || 0) + 1;
        }
      }
    }

    const teamLoad = employees.map(emp => {
      const loggedHours = Number((personHoursMap[emp.id] || 0).toFixed(1));
      const weeklyCap = Number(emp.weekly_capacity_hours || 40);
      const capacityHours = Number((weeklyCap * weeks).toFixed(1));
      const utilization = calculateUtilization(loggedHours, weeklyCap, weeks);
      const status = getUtilizationStatus(utilization);

      return {
        userId: emp.id,
        name: emp.name,
        email: emp.email,
        department: emp.department_name || 'General',
        designation: emp.designation_name || emp.role || 'Team Member',
        status: emp.productivity_status,
        weeklyCapacity: weeklyCap,
        capacityHours,
        hours: loggedHours,
        utilization,
        utilizationStatus: status,
        revenueCredit: Number((personRevenueMap[emp.id] || 0).toFixed(2)),
        jobsCount: personJobsMap[emp.id] || 0
      };
    });

    const overworkedCount = teamLoad.filter(p => p.utilization >= 115).length;
    const underusedCount = teamLoad.filter(p => p.utilization < 55 && p.hours > 0).length;

    // 8. Fetch standing account roster stats for oversight insights
    const rosterRows = await query(
      `SELECT r.id, r.client_id, r.difficulty, ra.user_id, u.name as user_name
       FROM productivity_account_rosters r
       JOIN productivity_account_roster_assignments ra ON ra.roster_id = r.id
       JOIN users u ON u.id = ra.user_id
       WHERE ra.user_id IS NOT NULL`
    );

    const rosterStatsMap = {};
    for (const r of rosterRows) {
      if (!rosterStatsMap[r.user_id]) {
        rosterStatsMap[r.user_id] = { userId: r.user_id, name: r.user_name, accountCount: 0, totalDifficulty: 0 };
      }
      rosterStatsMap[r.user_id].accountCount += 1;
      rosterStatsMap[r.user_id].totalDifficulty += Number(r.difficulty || 5);
    }
    const rosterStats = Object.values(rosterStatsMap);

    // 9. Generate Roadmap Insights
    const insights = buildProductivityInsights({
      personStats: teamLoad,
      serviceStats: revenueByService,
      rosterStats,
      clientStats: revenueByClient
    });

    return {
      period: {
        key: range.key,
        from: range.from,
        to: range.to,
        days: range.days,
        weeks: range.weeks
      },
      kpis: {
        revenueTracked,
        jobsLogged: jobs.length,
        hoursLogged: Number(hoursLogged.toFixed(1)),
        activeClients: clientsWithJobs.size,
        totalClients,
        overworked: overworkedCount,
        underused: underusedCount
      },
      revenueByClient,
      revenueByService,
      teamLoad,
      insights
    };
  }

  /**
   * Analysis Tab Data Aggregation
   */
  static async getAnalysis({ userContext, range }) {
    const trackingStart = formatDateYMD(getTrackingStart());
    const trackingEnd = formatDateYMD(getTrackingEnd());

    // 1. Fetch all productivity jobs within tracking cycle
    const allJobs = await query(
      `SELECT j.*, c.name as client_name
       FROM productivity_jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.deleted_at IS NULL
         AND j.start_date >= ? AND j.start_date <= ?
       ORDER BY j.start_date ASC`,
      [trackingStart, trackingEnd]
    );

    const jobIds = allJobs.map(j => j.id);
    let allAssignments = [];
    let allServices = [];

    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      allAssignments = await query(
        `SELECT ja.*, u.name as user_name
         FROM productivity_job_assignments ja
         LEFT JOIN users u ON u.id = ja.user_id
         WHERE ja.productivity_job_id IN (${placeholders})`,
        jobIds
      );

      allServices = await query(
        `SELECT js.productivity_job_id, s.id as service_id, s.name as service_name
         FROM productivity_job_services js
         JOIN productivity_services s ON s.id = js.service_id
         WHERE js.productivity_job_id IN (${placeholders})`,
        jobIds
      );
    }

    // 2. Trajectory KPIs (Last 30 Days vs Prior 30 Days)
    const now = new Date();
    const last30Start = formatDateYMD(new Date(now.getTime() - 30 * 86400000));
    const prior30Start = formatDateYMD(new Date(now.getTime() - 60 * 86400000));

    let totalRevenueLogged = 0;
    let totalEffortLogged = 0;
    let last30Revenue = 0;
    let last30Hours = 0;
    let prior30Revenue = 0;
    let prior30Hours = 0;

    const assignmentHoursByJob = {};
    for (const a of allAssignments) {
      totalEffortLogged += Number(a.hours_spent || 0);
      assignmentHoursByJob[a.productivity_job_id] = (assignmentHoursByJob[a.productivity_job_id] || 0) + Number(a.hours_spent || 0);
    }

    for (const j of allJobs) {
      const val = Number(j.value_amount || 0);
      totalRevenueLogged += val;
      const jobHours = assignmentHoursByJob[j.id] || 0;

      if (j.start_date >= last30Start) {
        last30Revenue += val;
        last30Hours += jobHours;
      } else if (j.start_date >= prior30Start && j.start_date < last30Start) {
        prior30Revenue += val;
        prior30Hours += jobHours;
      }
    }

    const revenueGrowth = prior30Revenue > 0
      ? Number((((last30Revenue - prior30Revenue) / prior30Revenue) * 100).toFixed(1))
      : (last30Revenue > 0 ? 100 : 0);

    const effortGrowth = prior30Hours > 0
      ? Number((((last30Hours - prior30Hours) / prior30Hours) * 100).toFixed(1))
      : (last30Hours > 0 ? 100 : 0);

    // 3. Monthly Trend (YYYY-MM)
    const monthlyMap = {};
    for (const j of allJobs) {
      const ym = (j.start_date || '').substring(0, 7) || '2026-07';
      if (!monthlyMap[ym]) {
        const [y, m] = ym.split('-');
        const dateObj = new Date(Number(y), Number(m) - 1, 1);
        const label = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        monthlyMap[ym] = { key: ym, label, jobs: 0, revenue: 0, hours: 0 };
      }
      monthlyMap[ym].jobs += 1;
      monthlyMap[ym].revenue += Number(j.value_amount || 0);
      monthlyMap[ym].hours += Number(assignmentHoursByJob[j.id] || 0);
    }

    const monthlyTrend = Object.values(monthlyMap).sort((a, b) => a.key.localeCompare(b.key));

    // 4. Revenue per Hour by Service
    const serviceStatsMap = {};
    for (const s of allServices) {
      if (!serviceStatsMap[s.service_id]) {
        serviceStatsMap[s.service_id] = { serviceId: s.service_id, name: s.service_name, revenue: 0, hours: 0 };
      }
    }

    const servicesByJob = {};
    for (const s of allServices) {
      if (!servicesByJob[s.productivity_job_id]) servicesByJob[s.productivity_job_id] = [];
      servicesByJob[s.productivity_job_id].push(s);
    }

    for (const j of allJobs) {
      const svcs = servicesByJob[j.id] || [];
      if (svcs.length > 0) {
        const revShare = Number(j.value_amount || 0) / svcs.length;
        const totalJobHours = assignmentHoursByJob[j.id] || 0;
        const hoursShare = totalJobHours / svcs.length;
        for (const s of svcs) {
          serviceStatsMap[s.service_id].revenue += revShare;
          serviceStatsMap[s.service_id].hours += hoursShare;
        }
      }
    }

    const serviceEfficiency = Object.values(serviceStatsMap)
      .map(s => ({
        ...s,
        revenuePerHour: s.hours > 0 ? Number((s.revenue / s.hours).toFixed(2)) : 0
      }))
      .filter(s => s.hours > 0)
      .sort((a, b) => b.revenuePerHour - a.revenuePerHour);

    // 5. Revenue per Hour by Person
    const personEffMap = {};
    for (const a of allAssignments) {
      if (a.user_id) {
        if (!personEffMap[a.user_id]) {
          personEffMap[a.user_id] = { userId: a.user_id, name: a.user_name || 'Team Member', revenue: 0, hours: 0 };
        }
        personEffMap[a.user_id].hours += Number(a.hours_spent || 0);
        const job = allJobs.find(j => j.id === a.productivity_job_id);
        if (job) {
          personEffMap[a.user_id].revenue += calculateRevenueCredit(job.value_amount, a.revenue_percent);
        }
      }
    }

    const personEfficiency = Object.values(personEffMap)
      .map(p => ({
        ...p,
        revenuePerHour: p.hours > 0 ? Number((p.revenue / p.hours).toFixed(2)) : 0
      }))
      .filter(p => p.hours > 0)
      .sort((a, b) => b.revenuePerHour - a.revenuePerHour);

    // 6. Client Concentration
    const clientMap = {};
    for (const j of allJobs) {
      if (!clientMap[j.client_id]) {
        clientMap[j.client_id] = { clientId: j.client_id, name: j.client_name, revenue: 0 };
      }
      clientMap[j.client_id].revenue += Number(j.value_amount || 0);
    }

    const clientConcentration = Object.values(clientMap)
      .map(c => {
        const share = totalRevenueLogged > 0 ? Number(((c.revenue / totalRevenueLogged) * 100).toFixed(1)) : 0;
        return {
          ...c,
          share,
          isHighRisk: share >= 40
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // 7. Workforce Roadmap Recommendations
    const employees = await query(
      `SELECT u.id, u.name, ds.name as designation_name,
              COALESCE(pes.weekly_capacity_hours, 40.00) as weekly_capacity_hours,
              COALESCE(pes.productivity_status, 'active') as productivity_status
       FROM users u
       LEFT JOIN designations ds ON ds.id = u.designation_id
       LEFT JOIN productivity_employee_settings pes ON pes.user_id = u.id
       WHERE u.status = 'active' AND u.account_type IN ('employee', 'admin', 'super_admin')`
    );

    const trackingWeeks = Math.max(1, (new Date(trackingEnd).getTime() - new Date(trackingStart).getTime()) / (7 * 86400000));

    const workforceRoadmap = employees.map(emp => {
      const personData = personEffMap[emp.id] || { hours: 0, revenue: 0 };
      const utilization = calculateUtilization(personData.hours, emp.weekly_capacity_hours, trackingWeeks);
      const status = getUtilizationStatus(utilization);

      let recommendation = 'Maintain current workload balance';
      if (utilization >= 115) {
        recommendation = 'Critical: Reduce direct job load, add backup support or delegate';
      } else if (utilization >= 90) {
        recommendation = 'Approaching capacity: Monitor closely before adding new accounts';
      } else if (utilization < 25) {
        recommendation = 'High capacity available: Assign lead responsibilities or new client accounts';
      } else if (utilization < 55) {
        recommendation = 'Capacity available: Good candidate for cross-functional support';
      }

      return {
        userId: emp.id,
        name: emp.name,
        duties: emp.designation_name || 'Operations',
        utilization,
        status,
        hours: Number(personData.hours.toFixed(1)),
        revenueCredit: Number(personData.revenue.toFixed(2)),
        recommendation
      };
    }).sort((a, b) => b.utilization - a.utilization);

    return {
      trajectory: {
        totalRevenueLogged,
        totalEffortLogged: Number(totalEffortLogged.toFixed(1)),
        last30Revenue,
        last30Hours: Number(last30Hours.toFixed(1)),
        prior30Revenue,
        prior30Hours: Number(prior30Hours.toFixed(1)),
        revenueGrowth,
        effortGrowth
      },
      monthlyTrend,
      serviceEfficiency,
      personEfficiency,
      clientConcentration,
      workforceRoadmap
    };
  }

  /**
   * Standing Account Roster Management
   */
  static async getAccountsRoster() {
    const clients = await query(`SELECT id, name, status FROM clients ORDER BY name ASC`);
    const rosters = await query(`SELECT * FROM productivity_account_rosters`);
    const assignments = await query(
      `SELECT ra.*, u.name as user_name, u.email as user_email
       FROM productivity_account_roster_assignments ra
       LEFT JOIN users u ON u.id = ra.user_id`
    );

    const assignmentsByRoster = {};
    for (const a of assignments) {
      if (!assignmentsByRoster[a.roster_id]) assignmentsByRoster[a.roster_id] = {};
      assignmentsByRoster[a.roster_id][a.responsibility_key] = {
        assigneeType: a.assignee_type,
        userId: a.user_id,
        userName: a.user_name,
        externalName: a.external_name
      };
    }

    const rosterList = clients.map(c => {
      const r = rosters.find(item => item.client_id === c.id);
      return {
        rosterId: r ? r.id : null,
        clientId: c.id,
        clientName: c.name,
        clientStatus: c.status,
        nature: r ? r.nature : 'Existing',
        difficulty: r ? Number(r.difficulty) : 5,
        comments: r ? r.comments : '',
        assignments: r ? (assignmentsByRoster[r.id] || {}) : {}
      };
    }).sort((a, b) => {
      if (a.nature !== b.nature) return a.nature === 'Existing' ? -1 : 1;
      return b.difficulty - a.difficulty;
    });

    // Account load by person
    const personLoadMap = {};
    for (const r of rosters) {
      const asgns = assignments.filter(a => a.roster_id === r.id);
      const userIdsInRoster = new Set(asgns.filter(a => a.user_id).map(a => a.user_id));
      for (const uId of userIdsInRoster) {
        const asgn = asgns.find(a => a.user_id === uId);
        if (!personLoadMap[uId]) {
          personLoadMap[uId] = { userId: uId, name: asgn?.user_name || 'Member', accountCount: 0, combinedDifficulty: 0 };
        }
        personLoadMap[uId].accountCount += 1;
        personLoadMap[uId].combinedDifficulty += Number(r.difficulty || 5);
      }
    }

    const accountLoadByPerson = Object.values(personLoadMap).sort((a, b) => b.combinedDifficulty - a.combinedDifficulty);

    return {
      rosters: rosterList,
      accountLoadByPerson
    };
  }

  /**
   * Save or Update Single Account Roster
   */
  static async saveAccountRoster({ userContext, payload }) {
    return await transaction(async connection => {
      const { clientId, nature = 'Existing', difficulty = 5, comments = '', assignments = {} } = payload;

      await connection.execute(
        `INSERT INTO productivity_account_rosters (client_id, nature, difficulty, comments)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nature=VALUES(nature), difficulty=VALUES(difficulty), comments=VALUES(comments), updated_at=NOW(3)`,
        [clientId, nature, difficulty, comments]
      );

      const rosterRow = await one(`SELECT id FROM productivity_account_rosters WHERE client_id=?`, [clientId], connection);
      const rosterId = rosterRow.id;

      // Clear existing roster assignments and re-insert
      await connection.execute(`DELETE FROM productivity_account_roster_assignments WHERE roster_id=?`, [rosterId]);

      const keys = ['strategy', 'cs', 'website', 'design', 'copy', 'edit', 'shoot', 'seo', 'smo', 'qc'];
      for (const k of keys) {
        const item = assignments[k];
        if (item) {
          await connection.execute(
            `INSERT INTO productivity_account_roster_assignments
             (roster_id, responsibility_key, assignee_type, user_id, external_name)
             VALUES (?, ?, ?, ?, ?)`,
            [
              rosterId,
              k,
              item.assigneeType || (item.userId ? 'employee' : 'tbd'),
              item.userId || null,
              item.externalName || null
            ]
          );
        }
      }

      await audit(userContext.id, 'productivity_roster_updated', 'productivity_account_roster', rosterId, { clientId, nature, difficulty }, connection);
      return { success: true, rosterId };
    });
  }

  /**
   * Reassign All Accounts from One Employee to Another
   */
  static async reassignPersonAccounts({ userContext, fromUserId, toUserId, markInactive = false }) {
    return await transaction(async connection => {
      const affected = await query(
        `SELECT DISTINCT roster_id FROM productivity_account_roster_assignments WHERE user_id=?`,
        [fromUserId],
        connection
      );

      await connection.execute(
        `UPDATE productivity_account_roster_assignments
         SET user_id=?, assignee_type='employee'
         WHERE user_id=?`,
        [toUserId, fromUserId]
      );

      if (markInactive) {
        await connection.execute(
          `INSERT INTO productivity_employee_settings (user_id, productivity_status)
           VALUES (?, 'inactive')
           ON DUPLICATE KEY UPDATE productivity_status='inactive', updated_at=NOW(3)`,
          [fromUserId]
        );
      }

      await audit(
        userContext.id,
        'productivity_roster_reassigned',
        'user',
        fromUserId,
        { fromUserId, toUserId, affectedRostersCount: affected.length, markInactive },
        connection
      );

      return { success: true, affectedCount: affected.length };
    });
  }

  /**
   * Throughput Targets Management
   */
  static async getTargets() {
    const targets = await query(
      `SELECT t.*, u.name as user_name, u.email as user_email,
              s.name as service_name
       FROM productivity_targets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN productivity_services s ON s.id = t.service_id
       WHERE t.is_active = 1
       ORDER BY u.name ASC, t.created_at DESC`
    );

    // Calculate actual work logged for targets
    const now = new Date();
    const todayStr = formatDateYMD(now);

    // Week bounds
    const dayOfWeek = now.getDay(); // 0 = Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // Monday start
    const weekStartStr = formatDateYMD(weekStart);

    // Month bounds
    const monthStartStr = formatDateYMD(new Date(now.getFullYear(), now.getMonth(), 1));

    const targetsWithActuals = await Promise.all(targets.map(async t => {
      let fromDate = weekStartStr;
      if (t.period === 'day') fromDate = todayStr;
      else if (t.period === 'month') fromDate = monthStartStr;

      let actual = 0;
      if (t.service_id) {
        if (t.unit === 'hours') {
          const res = await one(
            `SELECT COALESCE(SUM(ja.hours_spent), 0) as total
             FROM productivity_job_assignments ja
             JOIN productivity_jobs j ON j.id = ja.productivity_job_id
             JOIN productivity_job_services js ON js.productivity_job_id = j.id
             WHERE j.deleted_at IS NULL
               AND ja.user_id = ?
               AND js.service_id = ?
               AND j.start_date >= ? AND j.start_date <= ?`,
            [t.user_id, t.service_id, fromDate, todayStr]
          );
          actual = Number(res?.total || 0);
        } else {
          const res = await one(
            `SELECT COUNT(DISTINCT j.id) as total
             FROM productivity_jobs j
             JOIN productivity_job_assignments ja ON ja.productivity_job_id = j.id
             JOIN productivity_job_services js ON js.productivity_job_id = j.id
             WHERE j.deleted_at IS NULL
               AND ja.user_id = ?
               AND js.service_id = ?
               AND j.start_date >= ? AND j.start_date <= ?`,
            [t.user_id, t.service_id, fromDate, todayStr]
          );
          actual = Number(res?.total || 0);
        }
      } else {
        if (t.unit === 'hours') {
          const res = await one(
            `SELECT COALESCE(SUM(ja.hours_spent), 0) as total
             FROM productivity_job_assignments ja
             JOIN productivity_jobs j ON j.id = ja.productivity_job_id
             WHERE j.deleted_at IS NULL
               AND ja.user_id = ?
               AND j.start_date >= ? AND j.start_date <= ?`,
            [t.user_id, fromDate, todayStr]
          );
          actual = Number(res?.total || 0);
        } else {
          const res = await one(
            `SELECT COUNT(DISTINCT j.id) as total
             FROM productivity_jobs j
             JOIN productivity_job_assignments ja ON ja.productivity_job_id = j.id
             WHERE j.deleted_at IS NULL
               AND ja.user_id = ?
               AND j.start_date >= ? AND j.start_date <= ?`,
            [t.user_id, fromDate, todayStr]
          );
          actual = Number(res?.total || 0);
        }
      }

      const targetVal = Number(t.quantity || 1);
      const pace = calculateTargetPace(actual, targetVal);

      return {
        ...t,
        quantity: targetVal,
        actual,
        pace
      };
    }));

    return targetsWithActuals;
  }

  static async saveTarget({ userContext, payload, id = null }) {
    const { userId, serviceId = null, quantity = 1, unit = 'count', period = 'week' } = payload;
    if (id) {
      await query(
        `UPDATE productivity_targets
         SET user_id=?, service_id=?, quantity=?, unit=?, period=?, updated_at=NOW(3)
         WHERE id=?`,
        [userId, serviceId || null, quantity, unit, period, id]
      );
      await audit(userContext.id, 'productivity_target_updated', 'productivity_target', id, payload);
      return { id };
    } else {
      const res = await query(
        `INSERT INTO productivity_targets (user_id, service_id, quantity, unit, period, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, serviceId || null, quantity, unit, period, userContext.id]
      );
      const newId = res.insertId;
      await audit(userContext.id, 'productivity_target_created', 'productivity_target', newId, payload);
      return { id: newId };
    }
  }

  static async deleteTarget({ userContext, id }) {
    await query(`UPDATE productivity_targets SET is_active=0, updated_at=NOW(3) WHERE id=?`, [id]);
    await audit(userContext.id, 'productivity_target_deleted', 'productivity_target', id);
    return { success: true };
  }

  /**
   * Comparative Reports (MTD, YTD, LMTD, LYTD)
   */
  static async getReports({ serviceId = null }) {
    const ranges = getComparativeReportRanges();
    const clients = await query(`SELECT id, name FROM clients ORDER BY name ASC`);
    const employees = await query(
      `SELECT u.id, u.name, ds.name as designation_name
       FROM users u
       LEFT JOIN designations ds ON ds.id = u.designation_id
       WHERE u.status='active' AND u.account_type IN ('employee','admin','super_admin')
       ORDER BY u.name ASC`
    );

    const runPeriodMetrics = async range => {
      let serviceFilter = '';
      const params = [range.from, range.to];
      if (serviceId) {
        serviceFilter = 'JOIN productivity_job_services js ON js.productivity_job_id = j.id AND js.service_id = ?';
        params.push(serviceId);
      }

      const jobs = await query(
        `SELECT DISTINCT j.id, j.client_id, j.value_amount
         FROM productivity_jobs j
         ${serviceFilter}
         WHERE j.deleted_at IS NULL
           AND j.start_date >= ? AND j.start_date <= ?`,
        params
      );

      const jobIds = jobs.map(j => j.id);
      let assignments = [];
      if (jobIds.length > 0) {
        const placeholders = jobIds.map(() => '?').join(',');
        assignments = await query(
          `SELECT ja.* FROM productivity_job_assignments ja WHERE ja.productivity_job_id IN (${placeholders})`,
          jobIds
        );
      }

      // Total org
      const orgJobs = jobs.length;
      const orgHours = assignments.reduce((sum, a) => sum + Number(a.hours_spent || 0), 0);

      // By Client
      const clientStats = {};
      for (const j of jobs) {
        if (!clientStats[j.client_id]) clientStats[j.client_id] = { jobs: 0, hours: 0 };
        clientStats[j.client_id].jobs += 1;
      }
      for (const a of assignments) {
        const j = jobs.find(job => job.id === a.productivity_job_id);
        if (j && clientStats[j.client_id]) {
          clientStats[j.client_id].hours += Number(a.hours_spent || 0);
        }
      }

      // By Person
      const personStats = {};
      for (const a of assignments) {
        if (a.user_id) {
          if (!personStats[a.user_id]) personStats[a.user_id] = { jobs: 0, hours: 0 };
          personStats[a.user_id].hours += Number(a.hours_spent || 0);
          personStats[a.user_id].jobs += 1;
        }
      }

      return { orgJobs, orgHours, clientStats, personStats };
    };

    const [mtdRes, ytdRes, lmtdRes, lytdRes] = await Promise.all([
      runPeriodMetrics(ranges.mtd),
      runPeriodMetrics(ranges.ytd),
      runPeriodMetrics(ranges.lmtd),
      runPeriodMetrics(ranges.lytd)
    ]);

    const organizationTotals = {
      mtd: { jobs: mtdRes.orgJobs, hours: Number(mtdRes.orgHours.toFixed(1)) },
      ytd: { jobs: ytdRes.orgJobs, hours: Number(ytdRes.orgHours.toFixed(1)) },
      lmtd: { jobs: lmtdRes.orgJobs, hours: Number(lmtdRes.orgHours.toFixed(1)) },
      lytd: { jobs: lytdRes.orgJobs, hours: Number(lytdRes.orgHours.toFixed(1)) }
    };

    const byClient = clients.map(c => ({
      clientId: c.id,
      name: c.name,
      mtd: { jobs: mtdRes.clientStats[c.id]?.jobs || 0, hours: Number((mtdRes.clientStats[c.id]?.hours || 0).toFixed(1)) },
      ytd: { jobs: ytdRes.clientStats[c.id]?.jobs || 0, hours: Number((ytdRes.clientStats[c.id]?.hours || 0).toFixed(1)) },
      lmtd: { jobs: lmtdRes.clientStats[c.id]?.jobs || 0, hours: Number((lmtdRes.clientStats[c.id]?.hours || 0).toFixed(1)) },
      lytd: { jobs: lytdRes.clientStats[c.id]?.jobs || 0, hours: Number((lytdRes.clientStats[c.id]?.hours || 0).toFixed(1)) }
    })).filter(c => c.ytd.jobs > 0 || c.lytd.jobs > 0 || c.mtd.jobs > 0);

    const byPerson = employees.map(e => ({
      userId: e.id,
      name: e.name,
      duties: e.designation_name || 'Member',
      mtd: { jobs: mtdRes.personStats[e.id]?.jobs || 0, hours: Number((mtdRes.personStats[e.id]?.hours || 0).toFixed(1)) },
      ytd: { jobs: ytdRes.personStats[e.id]?.jobs || 0, hours: Number((ytdRes.personStats[e.id]?.hours || 0).toFixed(1)) },
      lmtd: { jobs: lmtdRes.personStats[e.id]?.jobs || 0, hours: Number((lmtdRes.personStats[e.id]?.hours || 0).toFixed(1)) },
      lytd: { jobs: lytdRes.personStats[e.id]?.jobs || 0, hours: Number((lytdRes.personStats[e.id]?.hours || 0).toFixed(1)) }
    })).filter(e => e.ytd.jobs > 0 || e.lytd.jobs > 0 || e.mtd.jobs > 0);

    return {
      organizationTotals,
      byClient,
      byPerson
    };
  }

  /**
   * Daily Log Aggregation
   */
  static async getDailyLog({ range }) {
    const jobs = await query(
      `SELECT j.*, c.name as client_name
       FROM productivity_jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.deleted_at IS NULL
         AND j.start_date >= ? AND j.start_date <= ?
       ORDER BY j.start_date DESC`,
      [range.from, range.to]
    );

    const jobIds = jobs.map(j => j.id);
    let assignments = [];
    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      assignments = await query(
        `SELECT ja.*, u.name as user_name, er.name as external_name
         FROM productivity_job_assignments ja
         LEFT JOIN users u ON u.id = ja.user_id
         LEFT JOIN productivity_external_resources er ON er.id = ja.external_resource_id
         WHERE ja.productivity_job_id IN (${placeholders})`,
        jobIds
      );
    }

    const assignmentsByJob = {};
    for (const a of assignments) {
      if (!assignmentsByJob[a.productivity_job_id]) assignmentsByJob[a.productivity_job_id] = [];
      assignmentsByJob[a.productivity_job_id].push(a);
    }

    const dateMap = {};
    for (const j of jobs) {
      const dateKey = j.start_date;
      if (!dateMap[dateKey]) {
        dateMap[dateKey] = { date: dateKey, jobsCount: 0, totalHours: 0, personHours: {} };
      }
      dateMap[dateKey].jobsCount += 1;
      const asgns = assignmentsByJob[j.id] || [];
      for (const a of asgns) {
        const name = a.user_name || a.external_name || 'Member';
        const hrs = Number(a.hours_spent || 0);
        dateMap[dateKey].totalHours += hrs;
        dateMap[dateKey].personHours[name] = (dateMap[dateKey].personHours[name] || 0) + hrs;
      }
    }

    return Object.values(dateMap).map(d => ({
      date: d.date,
      jobsCount: d.jobsCount,
      totalHours: Number(d.totalHours.toFixed(1)),
      personBreakdown: Object.entries(d.personHours).map(([name, hrs]) => `${name}: ${Number(hrs.toFixed(1))} hrs`)
    })).sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * By Client Aggregation
   */
  static async getByClient({ range }) {
    const clients = await query(`SELECT id, name FROM clients ORDER BY name ASC`);
    const jobs = await query(
      `SELECT j.*, c.name as client_name
       FROM productivity_jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.deleted_at IS NULL
         AND j.start_date >= ? AND j.start_date <= ?`,
      [range.from, range.to]
    );

    const jobIds = jobs.map(j => j.id);
    let assignments = [];
    let services = [];

    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      assignments = await query(
        `SELECT ja.*, u.name as user_name
         FROM productivity_job_assignments ja
         LEFT JOIN users u ON u.id = ja.user_id
         WHERE ja.productivity_job_id IN (${placeholders})`,
        jobIds
      );

      services = await query(
        `SELECT js.productivity_job_id, s.name as service_name
         FROM productivity_job_services js
         JOIN productivity_services s ON s.id = js.service_id
         WHERE js.productivity_job_id IN (${placeholders})`,
        jobIds
      );
    }

    const assignmentsByJob = {};
    for (const a of assignments) {
      if (!assignmentsByJob[a.productivity_job_id]) assignmentsByJob[a.productivity_job_id] = [];
      assignmentsByJob[a.productivity_job_id].push(a);
    }

    const servicesByJob = {};
    for (const s of services) {
      if (!servicesByJob[s.productivity_job_id]) servicesByJob[s.productivity_job_id] = [];
      servicesByJob[s.productivity_job_id].push(s.service_name);
    }

    const clientStats = clients.map(c => {
      const clientJobs = jobs.filter(j => j.client_id === c.id);
      let revenue = 0;
      let hours = 0;
      const people = new Set();
      const serviceCounts = {};

      for (const j of clientJobs) {
        revenue += Number(j.value_amount || 0);
        const asgns = assignmentsByJob[j.id] || [];
        for (const a of asgns) {
          hours += Number(a.hours_spent || 0);
          if (a.user_name) people.add(a.user_name);
        }
        const svcs = servicesByJob[j.id] || [];
        for (const sName of svcs) {
          serviceCounts[sName] = (serviceCounts[sName] || 0) + 1;
        }
      }

      const serviceChips = Object.entries(serviceCounts).map(([name, count]) => `${name} ×${count}`);

      return {
        clientId: c.id,
        name: c.name,
        revenue,
        jobsCount: clientJobs.length,
        hours: Number(hours.toFixed(1)),
        peopleInvolved: Array.from(people),
        servicesUsed: serviceChips
      };
    }).filter(c => c.jobsCount > 0 || c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    return clientStats;
  }

  /**
   * By Person Aggregation (with Salary Privacy)
   */
  static async getByPerson({ range, viewerUserId, hasSalaryViewPermission = false }) {
    const employees = await query(
      `SELECT u.id, u.name, u.email, ds.name as designation_name,
              COALESCE(pes.weekly_capacity_hours, 40.00) as weekly_capacity_hours,
              COALESCE(pes.productivity_status, 'active') as productivity_status
       FROM users u
       LEFT JOIN designations ds ON ds.id = u.designation_id
       LEFT JOIN productivity_employee_settings pes ON pes.user_id = u.id
       WHERE u.status = 'active' AND u.account_type IN ('employee','admin','super_admin')
       ORDER BY u.name ASC`
    );

    const assignments = await query(
      `SELECT ja.*, j.value_amount
       FROM productivity_job_assignments ja
       JOIN productivity_jobs j ON j.id = ja.productivity_job_id
       WHERE j.deleted_at IS NULL
         AND j.start_date >= ? AND j.start_date <= ?`,
      [range.from, range.to]
    );

    // Private salary grades if viewer is authorized
    let salaryMap = {};
    if (hasSalaryViewPermission) {
      const salaryAssignments = await query(
        `SELECT sa.employee_user_id, sg.label as grade_label, sg.min_amount, sg.max_amount
         FROM productivity_salary_assignments sa
         JOIN productivity_salary_grades sg ON sg.id = sa.grade_id
         WHERE sa.owner_user_id = ?`,
        [viewerUserId]
      );
      for (const sa of salaryAssignments) {
        const midpoint = (Number(sa.min_amount) + Number(sa.max_amount)) / 2;
        salaryMap[sa.employee_user_id] = {
          gradeLabel: sa.grade_label,
          midpoint
        };
      }
    }

    const personStats = employees.map(emp => {
      const empAsgns = assignments.filter(a => a.user_id === emp.id);
      let hours = 0;
      let revenueCredit = 0;
      for (const a of empAsgns) {
        hours += Number(a.hours_spent || 0);
        revenueCredit += calculateRevenueCredit(a.value_amount, a.revenue_percent);
      }

      const utilization = calculateUtilization(hours, emp.weekly_capacity_hours, range.weeks);
      const status = getUtilizationStatus(utilization);

      let salaryGrade = null;
      let efficiency = null;

      if (hasSalaryViewPermission && salaryMap[emp.id]) {
        salaryGrade = salaryMap[emp.id].gradeLabel;
        efficiency = calculateSalaryEfficiency(revenueCredit, salaryMap[emp.id].midpoint, range.months);
      }

      return {
        userId: emp.id,
        name: emp.name,
        duties: emp.designation_name || 'Operations',
        status: emp.productivity_status,
        weeklyCapacity: Number(emp.weekly_capacity_hours),
        hours: Number(hours.toFixed(1)),
        utilization,
        utilizationStatus: status,
        jobsCount: empAsgns.length,
        revenueCredit: Number(revenueCredit.toFixed(2)),
        salaryGrade,
        efficiency: efficiency !== null ? `${efficiency}×` : null
      };
    });

    return personStats;
  }

  /**
   * Jobs CRUD
   */
  static async getJobs({ range, status = 'all', clientId = null }) {
    let whereClauses = ['j.deleted_at IS NULL'];
    const params = [];

    if (range) {
      whereClauses.push('j.start_date >= ? AND j.start_date <= ?');
      params.push(range.from, range.to);
    }

    if (clientId) {
      whereClauses.push('j.client_id = ?');
      params.push(clientId);
    }

    if (status === 'completed') {
      whereClauses.push('j.completion_date IS NOT NULL');
    } else if (status === 'in_progress') {
      whereClauses.push('j.completion_date IS NULL');
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const jobs = await query(
      `SELECT j.*, c.name as client_name, u.name as created_by_name
       FROM productivity_jobs j
       JOIN clients c ON c.id = j.client_id
       LEFT JOIN users u ON u.id = j.created_by_user_id
       ${whereSql}
       ORDER BY j.start_date DESC`,
      params
    );

    const jobIds = jobs.map(j => j.id);
    let jobServices = [];
    let jobAssignments = [];

    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      jobServices = await query(
        `SELECT js.productivity_job_id, s.id as service_id, s.name as service_name
         FROM productivity_job_services js
         JOIN productivity_services s ON s.id = js.service_id
         WHERE js.productivity_job_id IN (${placeholders})`,
        jobIds
      );

      jobAssignments = await query(
        `SELECT ja.*, u.name as user_name, er.name as external_name
         FROM productivity_job_assignments ja
         LEFT JOIN users u ON u.id = ja.user_id
         LEFT JOIN productivity_external_resources er ON er.id = ja.external_resource_id
         WHERE ja.productivity_job_id IN (${placeholders})`,
        jobIds
      );
    }

    const servicesByJob = {};
    for (const s of jobServices) {
      if (!servicesByJob[s.productivity_job_id]) servicesByJob[s.productivity_job_id] = [];
      servicesByJob[s.productivity_job_id].push(s);
    }

    const assignmentsByJob = {};
    for (const a of jobAssignments) {
      if (!assignmentsByJob[a.productivity_job_id]) assignmentsByJob[a.productivity_job_id] = [];
      assignmentsByJob[a.productivity_job_id].push(a);
    }

    return jobs.map(j => {
      const svcs = servicesByJob[j.id] || [];
      const asgns = assignmentsByJob[j.id] || [];
      const totalHours = asgns.reduce((sum, a) => sum + Number(a.hours_spent || 0), 0);
      const tat = calculateProductivityTat(j.start_date, j.completion_date);
      const statusLabel = j.completion_date ? 'Completed' : 'In Progress';

      return {
        id: j.id,
        coreJobId: j.core_job_id,
        clientId: j.client_id,
        clientName: j.client_name,
        startDate: j.start_date,
        completionDate: j.completion_date,
        tatDays: tat !== null ? `${tat} ${tat === 1 ? 'day' : 'days'}` : '—',
        status: statusLabel,
        valueAmount: Number(j.value_amount),
        description: j.description || '',
        services: svcs,
        assignments: asgns,
        totalHours: Number(totalHours.toFixed(1)),
        createdAt: j.created_at
      };
    });
  }

  static async createJob({ userContext, payload }) {
    return await transaction(async connection => {
      const {
        clientId,
        startDate,
        completionDate = null,
        valueAmount = 0,
        description = '',
        serviceIds = [],
        assignments = []
      } = payload;

      const res = await connection.execute(
        `INSERT INTO productivity_jobs (client_id, start_date, completion_date, value_amount, description, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, startDate, completionDate || null, valueAmount, description, userContext.id]
      );
      const jobId = res[0].insertId;

      for (const svcId of serviceIds) {
        await connection.execute(
          `INSERT INTO productivity_job_services (productivity_job_id, service_id) VALUES (?, ?)`,
          [jobId, svcId]
        );
      }

      for (const asgn of assignments) {
        await connection.execute(
          `INSERT INTO productivity_job_assignments (productivity_job_id, user_id, external_resource_id, revenue_percent, hours_spent)
           VALUES (?, ?, ?, ?, ?)`,
          [jobId, asgn.userId || null, asgn.externalResourceId || null, asgn.revenuePercent ?? 100, asgn.hoursSpent ?? 0]
        );
      }

      await audit(userContext.id, 'productivity_job_created', 'productivity_job', jobId, { clientId, valueAmount, startDate }, connection);
      return { id: jobId };
    });
  }

  static async updateJob({ userContext, id, payload }) {
    return await transaction(async connection => {
      const {
        clientId,
        startDate,
        completionDate = null,
        valueAmount = 0,
        description = '',
        serviceIds = [],
        assignments = []
      } = payload;

      await connection.execute(
        `UPDATE productivity_jobs
         SET client_id=?, start_date=?, completion_date=?, value_amount=?, description=?, updated_at=NOW(3)
         WHERE id=?`,
        [clientId, startDate, completionDate || null, valueAmount, description, id]
      );

      await connection.execute(`DELETE FROM productivity_job_services WHERE productivity_job_id=?`, [id]);
      for (const svcId of serviceIds) {
        await connection.execute(
          `INSERT INTO productivity_job_services (productivity_job_id, service_id) VALUES (?, ?)`,
          [id, svcId]
        );
      }

      await connection.execute(`DELETE FROM productivity_job_assignments WHERE productivity_job_id=?`, [id]);
      for (const asgn of assignments) {
        await connection.execute(
          `INSERT INTO productivity_job_assignments (productivity_job_id, user_id, external_resource_id, revenue_percent, hours_spent)
           VALUES (?, ?, ?, ?, ?)`,
          [id, asgn.userId || null, asgn.externalResourceId || null, asgn.revenuePercent ?? 100, asgn.hoursSpent ?? 0]
        );
      }

      await audit(userContext.id, 'productivity_job_updated', 'productivity_job', id, payload, connection);
      return { id };
    });
  }

  static async deleteJob({ userContext, id }) {
    await query(
      `UPDATE productivity_jobs SET deleted_at=NOW(3), deleted_by_user_id=? WHERE id=?`,
      [userContext.id, id]
    );
    await audit(userContext.id, 'productivity_job_deleted', 'productivity_job', id);
    return { success: true };
  }

  /**
   * Services Management
   */
  static async getServices() {
    return await query(`SELECT * FROM productivity_services WHERE is_active=1 ORDER BY name ASC`);
  }

  static async saveService({ userContext, payload, id = null }) {
    const { name, referenceHours = 10.00 } = payload;
    if (id) {
      await query(
        `UPDATE productivity_services SET name=?, reference_hours=?, updated_at=NOW(3) WHERE id=?`,
        [name, referenceHours, id]
      );
      await audit(userContext.id, 'productivity_service_updated', 'productivity_service', id, payload);
      return { id };
    } else {
      const res = await query(
        `INSERT INTO productivity_services (name, reference_hours, created_by_user_id) VALUES (?, ?, ?)`,
        [name, referenceHours, userContext.id]
      );
      const newId = res.insertId;
      await audit(userContext.id, 'productivity_service_created', 'productivity_service', newId, payload);
      return { id: newId };
    }
  }

  static async deleteService({ userContext, id }) {
    await query(`UPDATE productivity_services SET is_active=0, updated_at=NOW(3) WHERE id=?`, [id]);
    await audit(userContext.id, 'productivity_service_deleted', 'productivity_service', id);
    return { success: true };
  }

  /**
   * Salary Grades & Assignments (Owner Scoped)
   */
  static async getSalaryGrades({ userContext }) {
    const grades = await query(
      `SELECT * FROM productivity_salary_grades WHERE owner_user_id=? ORDER BY min_amount ASC`,
      [userContext.id]
    );
    const assignments = await query(
      `SELECT sa.*, u.name as user_name
       FROM productivity_salary_assignments sa
       JOIN users u ON u.id = sa.employee_user_id
       WHERE sa.owner_user_id=?`,
      [userContext.id]
    );
    return { grades, assignments };
  }

  static async saveSalaryGrade({ userContext, payload, id = null }) {
    const { label, minAmount, maxAmount } = payload;
    if (id) {
      await query(
        `UPDATE productivity_salary_grades SET label=?, min_amount=?, max_amount=?, updated_at=NOW(3) WHERE id=? AND owner_user_id=?`,
        [label, minAmount, maxAmount, id, userContext.id]
      );
      return { id };
    } else {
      const res = await query(
        `INSERT INTO productivity_salary_grades (owner_user_id, label, min_amount, max_amount) VALUES (?, ?, ?, ?)`,
        [userContext.id, label, minAmount, maxAmount]
      );
      return { id: res.insertId };
    }
  }

  static async assignSalaryGrade({ userContext, employeeId, gradeId }) {
    await query(
      `INSERT INTO productivity_salary_assignments (owner_user_id, employee_user_id, grade_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE grade_id=VALUES(grade_id), updated_at=NOW(3)`,
      [userContext.id, employeeId, gradeId]
    );
    return { success: true };
  }

  /**
   * Employee Settings Management
   */
  static async getEmployeeSettings() {
    return await query(
      `SELECT u.id, u.name, u.email, d.name as department_name, ds.name as designation_name,
              COALESCE(pes.weekly_capacity_hours, 40.00) as weekly_capacity_hours,
              COALESCE(pes.productivity_status, 'active') as productivity_status
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN designations ds ON ds.id = u.designation_id
       LEFT JOIN productivity_employee_settings pes ON pes.user_id = u.id
       WHERE u.status = 'active' AND u.account_type IN ('employee','admin','super_admin')
       ORDER BY u.name ASC`
    );
  }

  static async updateEmployeeSetting({ userContext, userId, payload }) {
    const { weeklyCapacityHours = 48.00, productivityStatus = 'active', customDuties = null } = payload;
    await query(
      `INSERT INTO productivity_employee_settings (user_id, weekly_capacity_hours, productivity_status, custom_duties)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         weekly_capacity_hours=VALUES(weekly_capacity_hours),
         productivity_status=VALUES(productivity_status),
         custom_duties=COALESCE(VALUES(custom_duties), custom_duties),
         updated_at=NOW(3)`,
      [userId, weeklyCapacityHours, productivityStatus, customDuties]
    );
    await audit(userContext.id, 'productivity_employee_setting_updated', 'productivity_employee_settings', userId, payload);
    return { success: true };
  }

  /**
   * Export Complete Productivity Data
   */
  static async exportData({ userContext }) {
    const services = await query(`SELECT * FROM productivity_services WHERE is_active=1`);
    const jobs = await query(`SELECT * FROM productivity_jobs WHERE deleted_at IS NULL ORDER BY start_date DESC`);
    const jobServices = await query(`SELECT * FROM productivity_job_services`);
    const jobAssignments = await query(`SELECT * FROM productivity_job_assignments`);
    const rosters = await query(`SELECT * FROM productivity_account_rosters`);
    const rosterAssignments = await query(`SELECT * FROM productivity_account_roster_assignments`);
    const targets = await query(`SELECT * FROM productivity_targets WHERE is_active=1`);

    await audit(userContext.id, 'productivity_export_generated', 'productivity_export', 'all');

    return {
      exportedAt: new Date().toISOString(),
      exportedBy: userContext.id,
      services,
      jobs,
      jobServices,
      jobAssignments,
      rosters,
      rosterAssignments,
      targets
    };
  }
}
