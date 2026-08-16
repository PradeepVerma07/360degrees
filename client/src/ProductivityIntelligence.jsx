import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from './api';

const responsibilityKeys = [
  { key: 'strategy', label: 'Strategy' },
  { key: 'cs', label: 'CS' },
  { key: 'website', label: 'Website' },
  { key: 'design', label: 'Design' },
  { key: 'copy', label: 'Copy / Content' },
  { key: 'edit', label: 'Edit' },
  { key: 'shoot', label: 'Shoot' },
  { key: 'seo', label: 'SEO' },
  { key: 'smo', label: 'SMO' },
  { key: 'qc', label: 'Quality Check' }
];

const periodOptions = [
  { key: 'month', label: 'This Month' },
  { key: 'today', label: 'Today' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'all_time', label: 'All Time' },
  { key: 'custom', label: 'Custom' }
];

const can = (data, perm) => (data?.permissions || data?.user?.permissions || []).includes(perm);

export default function ProductivityIntelligence({ data, reload }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Tab Data States
  const [dashboardData, setDashboardData] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [accountsData, setAccountsData] = useState(null);
  const [targetsData, setTargetsData] = useState([]);
  const [reportsData, setReportsData] = useState(null);
  const [selectedReportService, setSelectedReportService] = useState('');
  const [dailyLogData, setDailyLogData] = useState([]);
  const [byClientData, setByClientData] = useState([]);
  const [byPersonData, setByPersonData] = useState([]);
  const [jobsData, setJobsData] = useState([]);
  const [servicesData, setServicesData] = useState([]);
  const [salaryData, setSalaryData] = useState(null);
  const [employeeSettingsData, setEmployeeSettingsData] = useState([]);

  // Modals
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [editingRoster, setEditingRoster] = useState(null);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState(null);

  const queryParams = useMemo(() => {
    const p = { period };
    if (period === 'custom') {
      if (customFrom) p.from = customFrom;
      if (customTo) p.to = customTo;
    }
    return p;
  }, [period, customFrom, customTo]);

  const loadTabData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      if (activeTab === 'dashboard') {
        const res = await api.productivityDashboard(queryParams);
        setDashboardData(res);
      } else if (activeTab === 'analysis') {
        const res = await api.productivityAnalysis(queryParams);
        setAnalysisData(res);
      } else if (activeTab === 'accounts') {
        const res = await api.productivityAccounts();
        setAccountsData(res);
      } else if (activeTab === 'targets') {
        const res = await api.productivityTargets();
        setTargetsData(res);
      } else if (activeTab === 'reports') {
        const res = await api.productivityReports({ serviceId: selectedReportService });
        setReportsData(res);
      } else if (activeTab === 'daily_log') {
        const res = await api.productivityDailyLog(queryParams);
        setDailyLogData(res);
      } else if (activeTab === 'by_client') {
        const res = await api.productivityByClient(queryParams);
        setByClientData(res);
      } else if (activeTab === 'by_person') {
        const res = await api.productivityByPerson(queryParams);
        setByPersonData(res);
      } else if (activeTab === 'all_jobs') {
        const res = await api.productivityJobs(queryParams);
        setJobsData(res);
      } else if (activeTab === 'salaries') {
        const res = await api.productivitySalaryGrades();
        setSalaryData(res);
      } else if (activeTab === 'manage') {
        const [svcs, emps] = await Promise.all([
          api.productivityServices(),
          api.productivitySettings()
        ]);
        setServicesData(svcs);
        setEmployeeSettingsData(emps);
      }

      // Pre-fetch services for form dropdowns if not loaded
      if (!servicesData.length) {
        api.productivityServices().then(setServicesData).catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [activeTab, queryParams, selectedReportService, servicesData.length]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Sub-navigation tabs with permissions
  const tabs = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', perm: 'productivity.dashboard.view' },
    { id: 'analysis', label: 'Analysis', perm: 'productivity.analysis.view' },
    { id: 'accounts', label: 'Accounts', perm: 'productivity.accounts.view' },
    { id: 'targets', label: 'Targets', perm: 'productivity.targets.view' },
    { id: 'reports', label: 'Reports', perm: 'productivity.reports.view' },
    { id: 'log_job', label: 'Log a Job', perm: 'productivity.jobs.create' },
    { id: 'daily_log', label: 'Daily Log', perm: 'productivity.daily_log.view' },
    { id: 'by_client', label: 'By Client', perm: 'productivity.by_client.view' },
    { id: 'by_person', label: 'By Person', perm: 'productivity.by_person.view' },
    { id: 'all_jobs', label: 'All Jobs', perm: 'productivity.jobs.view' },
    { id: 'salaries', label: 'Salaries 🔒', perm: 'productivity.salaries.view' },
    { id: 'manage', label: 'Manage', perm: 'productivity.settings.manage' }
  ].filter(t => can(data, t.perm)), [data]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some(t => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  const employees = useMemo(() => {
    return (data?.clientOwners || []).filter(u => u.accountType !== 'client' || u.role !== 'client');
  }, [data]);

  return (
    <div className="productivity-container">
      {/* MODULE HEADER & SUB-NAVIGATION */}
      <div className="saas-card" style={{ marginBottom: '20px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          {/* Sub-nav Tabs */}
          <div className="prod-subnav-list">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                className={`prod-subnav-btn ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Period Filter (for relevant analytical tabs) */}
          {['dashboard', 'analysis', 'daily_log', 'by_client', 'by_person', 'all_jobs'].includes(activeTab) && (
            <div className="prod-period-picker">
              <span className="prod-period-label">Period:</span>
              <div className="prod-period-pills">
                {periodOptions.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    className={`prod-period-btn ${period === p.key ? 'active' : ''}`}
                    onClick={() => setPeriod(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {period === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
                  <input
                    type="date"
                    className="form-control"
                    style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>to</span>
                  <input
                    type="date"
                    className="form-control"
                    style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert-banner error" style={{ marginBottom: '20px' }}>{error}</div>}

      {loading && !dashboardData && !analysisData && !accountsData && !jobsData.length ? (
        <div className="saas-card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--ci-text-secondary)', fontWeight: 500 }}>Calculating productivity intelligence...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && dashboardData && (
            <ProductivityDashboardTab
              data={dashboardData}
              onNavigateTab={setActiveTab}
            />
          )}

          {/* TAB 2: ANALYSIS */}
          {activeTab === 'analysis' && analysisData && (
            <ProductivityAnalysisTab data={analysisData} />
          )}

          {/* TAB 3: ACCOUNTS */}
          {activeTab === 'accounts' && accountsData && (
            <ProductivityAccountsTab
              data={accountsData}
              userPermissions={data.permissions || []}
              onEditRoster={roster => {
                setEditingRoster(roster);
                setShowRosterModal(true);
              }}
              onOpenReassign={() => setShowReassignModal(true)}
            />
          )}

          {/* TAB 4: TARGETS */}
          {activeTab === 'targets' && (
            <ProductivityTargetsTab
              targets={targetsData}
              services={servicesData}
              employees={employees}
              canManage={can(data, 'productivity.targets.manage')}
              onAddTarget={() => {
                setEditingTarget(null);
                setShowTargetModal(true);
              }}
              onEditTarget={t => {
                setEditingTarget(t);
                setShowTargetModal(true);
              }}
              onDeleteTarget={async id => {
                if (confirm('Are you sure you want to remove this target?')) {
                  await api.deleteProductivityTarget(id);
                  loadTabData();
                }
              }}
            />
          )}

          {/* TAB 5: REPORTS */}
          {activeTab === 'reports' && reportsData && (
            <ProductivityReportsTab
              reports={reportsData}
              services={servicesData}
              selectedService={selectedReportService}
              onSelectService={setSelectedReportService}
            />
          )}

          {/* TAB 6: LOG A JOB */}
          {activeTab === 'log_job' && (
            <ProductivityLogJobTab
              clients={data.clients || []}
              services={servicesData}
              employees={employees}
              onJobLogged={() => {
                setActiveTab('all_jobs');
                loadTabData();
              }}
            />
          )}

          {/* TAB 7: DAILY LOG */}
          {activeTab === 'daily_log' && (
            <ProductivityDailyLogTab log={dailyLogData} />
          )}

          {/* TAB 8: BY CLIENT */}
          {activeTab === 'by_client' && (
            <ProductivityByClientTab clients={byClientData} />
          )}

          {/* TAB 9: BY PERSON */}
          {activeTab === 'by_person' && (
            <ProductivityByPersonTab persons={byPersonData} />
          )}

          {/* TAB 10: ALL JOBS */}
          {activeTab === 'all_jobs' && (
            <ProductivityJobsTab
              jobs={jobsData}
              canEdit={can(data, 'productivity.jobs.edit')}
              canDelete={can(data, 'productivity.jobs.delete')}
              onEditJob={j => {
                setEditingJob(j);
                setShowJobModal(true);
              }}
              onDeleteJob={async id => {
                if (confirm('Are you sure you want to delete this productivity work record?')) {
                  await api.deleteProductivityJob(id);
                  loadTabData();
                }
              }}
            />
          )}

          {/* TAB 11: SALARIES 🔒 */}
          {activeTab === 'salaries' && salaryData && (
            <ProductivitySalariesTab
              salaryData={salaryData}
              employees={employees}
              canManage={can(data, 'productivity.salaries.manage')}
              onReload={loadTabData}
            />
          )}

          {/* TAB 12: MANAGE */}
          {activeTab === 'manage' && (
            <ProductivityManageTab
              services={servicesData}
              employees={employeeSettingsData}
              onReload={loadTabData}
              onAddService={() => {
                setEditingService(null);
                setShowServiceModal(true);
              }}
              onEditService={s => {
                setEditingService(s);
                setShowServiceModal(true);
              }}
              onDeleteService={async id => {
                if (confirm('Delete this service?')) {
                  await api.deleteProductivityService(id);
                  loadTabData();
                }
              }}
            />
          )}
        </>
      )}

      {/* MODALS */}
      {showRosterModal && (
        <EditRosterModal
          roster={editingRoster}
          employees={employees}
          onClose={() => setShowRosterModal(false)}
          onSaved={() => {
            setShowRosterModal(false);
            loadTabData();
          }}
        />
      )}

      {showReassignModal && (
        <ReassignAccountsModal
          employees={employees}
          onClose={() => setShowReassignModal(false)}
          onReassigned={() => {
            setShowReassignModal(false);
            loadTabData();
          }}
        />
      )}

      {showTargetModal && (
        <TargetFormModal
          target={editingTarget}
          employees={employees}
          services={servicesData}
          onClose={() => setShowTargetModal(false)}
          onSaved={() => {
            setShowTargetModal(false);
            loadTabData();
          }}
        />
      )}

      {showServiceModal && (
        <ServiceFormModal
          service={editingService}
          onClose={() => setShowServiceModal(false)}
          onSaved={() => {
            setShowServiceModal(false);
            loadTabData();
          }}
        />
      )}

      {showJobModal && editingJob && (
        <EditJobModal
          job={editingJob}
          clients={data.clients || []}
          services={servicesData}
          employees={employees}
          onClose={() => setShowJobModal(false)}
          onSaved={() => {
            setShowJobModal(false);
            loadTabData();
          }}
        />
      )}
    </div>
  );
}

// ==========================================================================
// TAB 1: DASHBOARD
// ==========================================================================
function ProductivityDashboardTab({ data, onNavigateTab }) {
  const { kpis, revenueByClient, revenueByService, teamLoad, insights } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* TOP 4 KPI CARDS */}
      <div className="metrics-2x2-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {/* KPI 1: Revenue Tracked */}
        <div className="metric-box">
          <span className="metric-title">Revenue Tracked</span>
          <span className="metric-number" style={{ color: 'var(--ci-navy)' }}>
            ₹{Number(kpis.revenueTracked || 0).toLocaleString('en-IN')}
          </span>
          <span className="metric-subtext">
            across {kpis.activeClients} active of {kpis.totalClients} total clients
          </span>
        </div>

        {/* KPI 2: Jobs Logged */}
        <div className="metric-box">
          <span className="metric-title">Jobs Logged</span>
          <span className="metric-number">{kpis.jobsLogged}</span>
          <span className="metric-subtext">
            Total Effort: {kpis.hoursLogged} hours
          </span>
        </div>

        {/* KPI 3: Overworked */}
        <div className="metric-box" style={{ borderLeft: '4px solid var(--ci-danger)' }}>
          <span className="metric-title">Overworked (≥ 115%)</span>
          <span className="metric-number" style={{ color: 'var(--ci-danger)' }}>
            {kpis.overworked}
          </span>
          <span className="metric-subtext">People over capacity threshold</span>
        </div>

        {/* KPI 4: Underused Capacity */}
        <div className="metric-box" style={{ borderLeft: '4px solid var(--ci-info)' }}>
          <span className="metric-title">Available Capacity</span>
          <span className="metric-number" style={{ color: 'var(--ci-info)' }}>
            {kpis.underused}
          </span>
          <span className="metric-subtext">People below 55% utilization</span>
        </div>
      </div>

      {/* ROADMAP SIGNALS / INSIGHTS */}
      {insights && insights.length > 0 && (
        <div className="saas-card" style={{ borderLeft: '4px solid var(--ci-gold)' }}>
          <div className="card-header" style={{ marginBottom: '12px' }}>
            <h3 className="card-title" style={{ fontSize: '15px' }}>Roadmap Signals & Workload Insights</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {insights.map(item => (
              <div
                key={item.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: item.severity === 'critical' ? 'var(--ci-danger-bg)' : item.severity === 'warning' ? 'var(--ci-warning-bg)' : 'var(--ci-surface)',
                  border: `1px solid ${item.severity === 'critical' ? 'var(--ci-danger-border)' : item.severity === 'warning' ? 'var(--ci-warning-border)' : 'var(--ci-border)'}`,
                  fontSize: '13px'
                }}
              >
                <strong style={{ display: 'block', marginBottom: '2px', color: item.severity === 'critical' ? 'var(--ci-danger)' : item.severity === 'warning' ? 'var(--ci-warning)' : 'var(--ci-text)' }}>
                  {item.title}
                </strong>
                <p style={{ margin: 0, color: 'var(--ci-text)' }}>{item.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2-COLUMN GRID: REVENUE BY CLIENT & REVENUE BY SERVICE */}
      <div className="overview-grid">
        {/* REVENUE BY CLIENT */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Revenue by Client</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Jobs</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueByClient.map(c => (
                  <tr key={c.clientId}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.jobCount}</td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>
                      ₹{Number(c.revenue).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* REVENUE BY SERVICE */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Revenue by Service</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Attributed Rev</th>
                  <th>Effort Hours</th>
                </tr>
              </thead>
              <tbody>
                {revenueByService.map(s => (
                  <tr key={s.serviceId}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>
                      ₹{Number(s.revenue).toLocaleString('en-IN')}
                    </td>
                    <td>{Number(s.hours).toFixed(1)} hrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* TEAM LOAD AT A GLANCE */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Team Load at a Glance</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Duties / Role</th>
                <th>Logged Hours</th>
                <th>Capacity</th>
                <th>Utilization</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {teamLoad.map(p => {
                let badgeClass = 'badge-priority-low';
                if (p.utilizationStatus === 'overworked') badgeClass = 'badge-priority-urgent';
                else if (p.utilizationStatus === 'stretched') badgeClass = 'badge-priority-medium';
                else if (p.utilizationStatus === 'balanced') badgeClass = 'badge-status-completed';

                return (
                  <tr key={p.userId}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ color: 'var(--ci-text-secondary)' }}>{p.designation}</td>
                    <td style={{ fontWeight: 600 }}>{p.hours} hrs</td>
                    <td>{p.capacityHours} hrs</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontWeight: 700, width: '48px' }}>{p.utilization}%</span>
                        <div className="workload-progress-track" style={{ width: '120px' }}>
                          <div
                            className={`workload-progress-fill ${p.utilizationStatus === 'overworked' ? 'red' : p.utilizationStatus === 'stretched' ? 'amber' : p.utilizationStatus === 'balanced' ? 'green' : 'gray'}`}
                            style={{ width: `${Math.min(p.utilization, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${badgeClass}`}>
                        {p.utilizationStatus.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 2: ANALYSIS
// ==========================================================================
function ProductivityAnalysisTab({ data }) {
  const { trajectory, monthlyTrend, serviceEfficiency, personEfficiency, clientConcentration, workforceRoadmap } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* BUSINESS TRAJECTORY KPIS */}
      <div className="metrics-2x2-grid stats-grid">
        <div className="metric-box">
          <span className="metric-title">Total Revenue Logged</span>
          <span className="metric-number" style={{ color: 'var(--ci-navy)' }}>
            ₹{Number(trajectory.totalRevenueLogged || 0).toLocaleString('en-IN')}
          </span>
          <span className="metric-subtext">All-time tracking cycle</span>
        </div>

        <div className="metric-box">
          <span className="metric-title">Total Effort Logged</span>
          <span className="metric-number">{trajectory.totalEffortLogged} hrs</span>
          <span className="metric-subtext">Cumulative delivery hours</span>
        </div>

        <div className="metric-box">
          <span className="metric-title">Revenue Growth (30d)</span>
          <span className="metric-number" style={{ color: trajectory.revenueGrowth >= 0 ? 'var(--ci-success)' : 'var(--ci-danger)' }}>
            {trajectory.revenueGrowth > 0 ? `+${trajectory.revenueGrowth}%` : `${trajectory.revenueGrowth}%`}
          </span>
          <span className="metric-subtext">Last 30d (₹{Number(trajectory.last30Revenue).toLocaleString('en-IN')}) vs Prior 30d</span>
        </div>

        <div className="metric-box">
          <span className="metric-title">Effort Growth (30d)</span>
          <span className="metric-number" style={{ color: 'var(--ci-navy)' }}>
            {trajectory.effortGrowth > 0 ? `+${trajectory.effortGrowth}%` : `${trajectory.effortGrowth}%`}
          </span>
          <span className="metric-subtext">Last 30d ({trajectory.last30Hours} hrs) vs Prior 30d</span>
        </div>
      </div>

      {/* MONTHLY TREND & CLIENT CONCENTRATION */}
      <div className="overview-grid">
        {/* Monthly Trend */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Monthly Delivery Trend</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Jobs</th>
                  <th>Revenue</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTrend.map(m => (
                  <tr key={m.key}>
                    <td style={{ fontWeight: 600 }}>{m.label}</td>
                    <td>{m.jobs}</td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>₹{Number(m.revenue).toLocaleString('en-IN')}</td>
                    <td>{Number(m.hours).toFixed(1)} hrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Client Concentration Risk */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Client Concentration</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Revenue</th>
                  <th>Share</th>
                  <th>Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {clientConcentration.map(c => (
                  <tr key={c.clientId}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>₹{Number(c.revenue).toLocaleString('en-IN')}</td>
                    <td style={{ fontWeight: 700 }}>{c.share}%</td>
                    <td>
                      {c.isHighRisk ? (
                        <span className="badge badge-priority-urgent">HIGH CONCENTRATION</span>
                      ) : (
                        <span className="badge badge-status-completed">BALANCED</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* WORKFORCE ROADMAP TABLE */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Workforce Roadmap & Recommendations</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Duties</th>
                <th>Utilization</th>
                <th>Hours</th>
                <th>Revenue Credit</th>
                <th>Actionable Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {workforceRoadmap.map(p => (
                <tr key={p.userId}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.duties}</td>
                  <td style={{ fontWeight: 700 }}>{p.utilization}%</td>
                  <td>{p.hours} hrs</td>
                  <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>₹{Number(p.revenueCredit).toLocaleString('en-IN')}</td>
                  <td style={{ fontSize: '13px', color: p.status === 'overworked' ? 'var(--ci-danger)' : 'var(--ci-text)' }}>
                    {p.recommendation}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* REVENUE PER HOUR TABLES (SERVICE & PERSON) */}
      <div className="overview-grid">
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Revenue per Hour — by Service</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Attributed Rev</th>
                  <th>Hours</th>
                  <th>Rev / Hour</th>
                </tr>
              </thead>
              <tbody>
                {serviceEfficiency.map(s => (
                  <tr key={s.serviceId}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td>₹{Number(s.revenue).toLocaleString('en-IN')}</td>
                    <td>{Number(s.hours).toFixed(1)} hrs</td>
                    <td style={{ fontWeight: 700, color: 'var(--ci-success)' }}>₹{Number(s.revenuePerHour).toLocaleString('en-IN')}/hr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Revenue per Hour — by Person</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Revenue Credit</th>
                  <th>Hours</th>
                  <th>Rev / Hour</th>
                </tr>
              </thead>
              <tbody>
                {personEfficiency.map(p => (
                  <tr key={p.userId}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>₹{Number(p.revenue).toLocaleString('en-IN')}</td>
                    <td>{Number(p.hours).toFixed(1)} hrs</td>
                    <td style={{ fontWeight: 700, color: 'var(--ci-navy)' }}>₹{Number(p.revenuePerHour).toLocaleString('en-IN')}/hr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 3: ACCOUNTS (ROSTER)
// ==========================================================================
function ProductivityAccountsTab({ data, userPermissions, onEditRoster, onOpenReassign }) {
  const { rosters, accountLoadByPerson } = data;
  const canManage = userPermissions.includes('productivity.accounts.manage');

  const getDifficultyBadge = diff => {
    if (diff >= 9) return <span className="badge badge-priority-urgent">{diff} / 10 (Critical)</span>;
    if (diff >= 7) return <span className="badge badge-priority-medium">{diff} / 10 (High)</span>;
    if (diff >= 4) return <span className="badge badge-category">{diff} / 10 (Medium)</span>;
    return <span className="badge badge-status-completed">{diff} / 10 (Low)</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* TOP HEADER & ACTIONS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Standing Account Roster</h2>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Permanent operational assignments and difficulty scoring across all client accounts.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenReassign}
          >
            🔄 Reassign a Person's Accounts
          </button>
        )}
      </div>

      {/* ACCOUNT LOAD BY PERSON */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Account Ownership Load by Person</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Total Accounts Assigned</th>
                <th>Combined Difficulty Score</th>
              </tr>
            </thead>
            <tbody>
              {accountLoadByPerson.map(p => (
                <tr key={p.userId}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.accountCount} accounts</td>
                  <td style={{ fontWeight: 700, color: p.combinedDifficulty >= 25 ? 'var(--ci-danger)' : 'var(--ci-text)' }}>
                    {p.combinedDifficulty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* COMPLETE ACCOUNT ROSTER TABLE */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">All Accounts Roster ({rosters.length})</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table" style={{ fontSize: '12.5px' }}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Nature</th>
                <th>Strategy</th>
                <th>CS</th>
                <th>Website</th>
                <th>Design</th>
                <th>Copy</th>
                <th>Edit</th>
                <th>Shoot</th>
                <th>SEO</th>
                <th>SMO</th>
                <th>QC</th>
                <th>Difficulty</th>
                {canManage && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {rosters.map(r => (
                <tr key={r.clientId}>
                  <td style={{ fontWeight: 700, color: 'var(--ci-navy)', whiteSpace: 'nowrap' }}>{r.clientName}</td>
                  <td>
                    <span className={`badge ${r.nature === 'Existing' ? 'badge-status-completed' : 'badge-priority-medium'}`}>
                      {r.nature}
                    </span>
                  </td>
                  {responsibilityKeys.map(rk => {
                    const asgn = r.assignments?.[rk.key];
                    const name = asgn?.userName || asgn?.externalName || (asgn?.assigneeType === 'tbd' ? 'TBD' : '—');
                    return (
                      <td key={rk.key} style={{ whiteSpace: 'nowrap', color: name === '—' ? 'var(--ci-text-muted)' : 'var(--ci-text)' }}>
                        {name}
                      </td>
                    );
                  })}
                  <td>{getDifficultyBadge(r.difficulty)}</td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEditRoster(r)}
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 4: TARGETS
// ==========================================================================
function ProductivityTargetsTab({ targets, services, employees, canManage, onAddTarget, onEditTarget, onDeleteTarget }) {
  const getPaceBadge = pace => {
    if (pace === 'on_pace') return <span className="badge badge-status-completed">ON PACE</span>;
    if (pace === 'behind') return <span className="badge badge-priority-medium">BEHIND</span>;
    return <span className="badge badge-priority-urgent">OFF PACE</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Throughput Targets</h2>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Operational capacity quotas by person, service, and delivery cycle.
          </p>
        </div>
        {canManage && (
          <button type="button" className="btn btn-primary" onClick={onAddTarget}>
            + Set New Target
          </button>
        )}
      </div>

      <div className="saas-card">
        <div className="data-table-container">
          {targets.length === 0 ? (
            <div className="empty-state-box">
              <p className="empty-state-title">No targets configured yet</p>
              <p className="empty-state-text">Set individual throughput targets to monitor delivery pace.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Service Focus</th>
                  <th>Target</th>
                  <th>Unit</th>
                  <th>Period</th>
                  <th>Actual Delivered</th>
                  <th>Current Pace</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {targets.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.user_name}</td>
                    <td>{t.service_name || 'All Services'}</td>
                    <td style={{ fontWeight: 700 }}>{t.quantity}</td>
                    <td style={{ textTransform: 'capitalize' }}>{t.unit}</td>
                    <td style={{ textTransform: 'capitalize' }}>{t.period}</td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>{t.actual}</td>
                    <td>{getPaceBadge(t.pace)}</td>
                    {canManage && (
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onEditTarget(t)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--ci-danger)' }}
                            onClick={() => onDeleteTarget(t.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 5: REPORTS
// ==========================================================================
function ProductivityReportsTab({ reports, services, selectedService, onSelectService }) {
  const { organizationTotals, byClient, byPerson } = reports;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Comparative Productivity Reports</h2>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Multi-cycle performance metrics across MTD, YTD, LMTD, and LYTD.
          </p>
        </div>

        <select
          className="form-select"
          style={{ width: '240px' }}
          value={selectedService}
          onChange={e => onSelectService(e.target.value)}
        >
          <option value="">Filter by All Services</option>
          {services.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* ORGANIZATION TOTALS */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Organization Delivery Totals</h3>
        </div>
        <div className="metrics-2x2-grid stats-grid">
          <div className="metric-box">
            <span className="metric-title">Month to Date (MTD)</span>
            <span className="metric-number">{organizationTotals.mtd.jobs} jobs</span>
            <span className="metric-subtext">{organizationTotals.mtd.hours} total hours</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Year to Date (YTD)</span>
            <span className="metric-number">{organizationTotals.ytd.jobs} jobs</span>
            <span className="metric-subtext">{organizationTotals.ytd.hours} total hours</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Last Month to Date (LMTD)</span>
            <span className="metric-number">{organizationTotals.lmtd.jobs} jobs</span>
            <span className="metric-subtext">{organizationTotals.lmtd.hours} total hours</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Last Year to Date (LYTD)</span>
            <span className="metric-number">{organizationTotals.lytd.jobs} jobs</span>
            <span className="metric-subtext">{organizationTotals.lytd.hours} total hours</span>
          </div>
        </div>
      </div>

      {/* BY CLIENT REPORT */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Comparative Report — by Client</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>MTD (Jobs / Hrs)</th>
                <th>YTD (Jobs / Hrs)</th>
                <th>LMTD (Jobs / Hrs)</th>
                <th>LYTD (Jobs / Hrs)</th>
              </tr>
            </thead>
            <tbody>
              {byClient.map(c => (
                <tr key={c.clientId}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><strong>{c.mtd.jobs}</strong> jobs / {c.mtd.hours}h</td>
                  <td><strong>{c.ytd.jobs}</strong> jobs / {c.ytd.hours}h</td>
                  <td><strong>{c.lmtd.jobs}</strong> jobs / {c.lmtd.hours}h</td>
                  <td><strong>{c.lytd.jobs}</strong> jobs / {c.lytd.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* BY PERSON REPORT */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Comparative Report — by Person</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>MTD (Jobs / Hrs)</th>
                <th>YTD (Jobs / Hrs)</th>
                <th>LMTD (Jobs / Hrs)</th>
                <th>LYTD (Jobs / Hrs)</th>
              </tr>
            </thead>
            <tbody>
              {byPerson.map(p => (
                <tr key={p.userId}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ color: 'var(--ci-text-secondary)' }}>{p.duties}</td>
                  <td><strong>{p.mtd.jobs}</strong> jobs / {p.mtd.hours}h</td>
                  <td><strong>{p.ytd.jobs}</strong> jobs / {p.ytd.hours}h</td>
                  <td><strong>{p.lmtd.jobs}</strong> jobs / {p.lmtd.hours}h</td>
                  <td><strong>{p.lytd.jobs}</strong> jobs / {p.lytd.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 6: LOG A JOB
// ==========================================================================
function ProductivityLogJobTab({ clients, services, employees, onJobLogged }) {
  const [clientId, setClientId] = useState(clients[0]?.id || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [completionDate, setCompletionDate] = useState('');
  const [valueAmount, setValueAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [assignments, setAssignments] = useState([
    { userId: employees[0]?.id || '', revenuePercent: 100, hoursSpent: '' }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const totalRevPercent = assignments.reduce((sum, a) => sum + Number(a.revenuePercent || 0), 0);

  const toggleService = id => {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const addPerson = () => {
    setAssignments(prev => [
      ...prev,
      { userId: employees[0]?.id || '', revenuePercent: 0, hoursSpent: '' }
    ]);
  };

  const updateAssignment = (index, field, val) => {
    setAssignments(prev =>
      prev.map((a, i) => (i === index ? { ...a, [field]: val } : a))
    );
  };

  const removeAssignment = index => {
    setAssignments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!clientId) return setError('Please select a client');
    if (selectedServiceIds.length === 0) return setError('Please select at least one service');
    if (assignments.length === 0) return setError('Please assign at least one team member');
    if (totalRevPercent !== 100) return setError(`Revenue allocation total must equal 100% (currently ${totalRevPercent}%)`);

    try {
      setSubmitting(true);
      setError('');
      await api.createProductivityJob({
        clientId,
        startDate,
        completionDate: completionDate || null,
        valueAmount: Number(valueAmount || 0),
        description,
        serviceIds: selectedServiceIds,
        assignments: assignments.map(a => ({
          userId: a.userId,
          revenuePercent: Number(a.revenuePercent || 0),
          hoursSpent: Number(a.hoursSpent || 0)
        }))
      });
      onJobLogged();
    } catch (err) {
      setError(err.message || 'Failed to log job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto' }}>
      <div className="saas-card">
        <div className="card-header">
          <h2 className="card-title">Log a Productivity Deliverable</h2>
        </div>

        {error && <div className="alert-banner error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Client</label>
              <select
                className="form-select"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                required
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Job Value (₹)</label>
              <input
                type="number"
                min="0"
                className="form-control"
                placeholder="e.g. 50000"
                value={valueAmount}
                onChange={e => setValueAmount(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-control"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Completion Date (leave blank if In Progress)</label>
              <input
                type="date"
                className="form-control"
                value={completionDate}
                onChange={e => setCompletionDate(e.target.value)}
              />
            </div>
          </div>

          {/* SERVICES MULTI-SELECT DROPDOWN */}
          <div className="form-group">
            <label className="form-label">Services Attached</label>
            <select
              className="form-select"
              value=""
              onChange={e => {
                const id = Number(e.target.value);
                if (id && !selectedServiceIds.includes(id)) {
                  setSelectedServiceIds([...selectedServiceIds, id]);
                }
              }}
            >
              <option value="">-- Choose and attach services (Click to add) --</option>
              {services.map(s => (
                <option key={s.id} value={s.id} disabled={selectedServiceIds.includes(s.id)}>
                  {s.name} ({s.referenceHours || s.reference_hours}h) {selectedServiceIds.includes(s.id) ? '✓ Attached' : ''}
                </option>
              ))}
            </select>

            {/* Selected Service Badges */}
            {selectedServiceIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {selectedServiceIds.map(id => {
                  const s = services.find(x => x.id === id);
                  if (!s) return null;
                  return (
                    <span
                      key={id}
                      className="badge badge-category"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        background: 'var(--ci-surface)',
                        color: 'var(--ci-navy)',
                        border: '1px solid var(--ci-border)'
                      }}
                    >
                      ✓ {s.name} ({s.referenceHours || s.reference_hours}h)
                      <button
                        type="button"
                        onClick={() => setSelectedServiceIds(selectedServiceIds.filter(x => x !== id))}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--ci-danger)',
                          fontWeight: 'bold',
                          padding: '0 2px'
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Deliverable Description</label>
            <textarea
              className="form-textarea"
              placeholder="Scope details, assets produced, campaign context..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* MULTI-PERSON ASSIGNMENTS */}
          <div style={{ marginTop: '24px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <label className="form-label" style={{ margin: 0 }}>
                Team Member Effort & Revenue Allocation
              </label>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: totalRevPercent === 100 ? 'var(--ci-success)' : 'var(--ci-danger)'
                }}
              >
                {totalRevPercent}% of revenue allocated {totalRevPercent === 100 ? '✓' : '(must total 100%)'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {assignments.map((a, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                  <select
                    className="form-select"
                    value={a.userId}
                    onChange={e => updateAssignment(i, 'userId', e.target.value)}
                    required
                  >
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>

                  <div>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="form-control"
                      placeholder="Revenue %"
                      value={a.revenuePercent}
                      onChange={e => updateAssignment(i, 'revenuePercent', Number(e.target.value))}
                      required
                    />
                  </div>

                  <div>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="form-control"
                      placeholder="Hours spent"
                      value={a.hoursSpent}
                      onChange={e => updateAssignment(i, 'hoursSpent', e.target.value)}
                      required
                    />
                  </div>

                  {assignments.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ color: 'var(--ci-danger)' }}
                      onClick={() => removeAssignment(i)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '12px' }}
              onClick={addPerson}
            >
              + Add Person
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Recording...' : 'Record Deliverable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 7: DAILY LOG
// ==========================================================================
function ProductivityDailyLogTab({ log }) {
  const totalPeriodHours = useMemo(() => {
    return (log || []).reduce((sum, item) => sum + Number(item.totalHours || 0), 0).toFixed(1);
  }, [log]);
  const totalPeriodJobs = useMemo(() => {
    return (log || []).reduce((sum, item) => sum + Number(item.jobsCount || 0), 0);
  }, [log]);

  return (
    <div className="saas-card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="card-title">Daily Effort Log</h2>
          <p className="card-subtitle">Day-by-day effort tracking and team member allocations</p>
        </div>
        {log && log.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <span className="badge badge-category" style={{ padding: '6px 12px', fontSize: '13px' }}>
              Total Effort: {totalPeriodHours} hrs
            </span>
            <span className="badge badge-subtle" style={{ padding: '6px 12px', fontSize: '13px' }}>
              Deliverables: {totalPeriodJobs}
            </span>
          </div>
        )}
      </div>

      <div className="data-table-container">
        {!log || log.length === 0 ? (
          <div className="empty-state-box">
            <p className="empty-state-title">No daily logs recorded in this period</p>
            <p className="empty-state-desc">Select a different period above (such as "All Time" or "This Month") or log a deliverable.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Jobs Count</th>
                <th>Total Effort</th>
                <th>Team Contribution Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {log.map(item => (
                <tr key={item.date}>
                  <td style={{ fontWeight: 600 }}>{item.date}</td>
                  <td>
                    <span className="badge badge-subtle">{item.jobsCount} deliverables</span>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--ci-navy)' }}>{item.totalHours} hrs</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {item.personBreakdown.map((chip, i) => (
                        <span key={i} className="badge badge-category" style={{ fontSize: '12px' }}>
                          {chip}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 8: BY CLIENT
// ==========================================================================
function ProductivityByClientTab({ clients }) {
  return (
    <div className="saas-card">
      <div className="card-header">
        <h2 className="card-title">Client Account Effort & Revenue Performance</h2>
      </div>

      <div className="data-table-container">
        {clients.length === 0 ? (
          <div className="empty-state-box">
            <p className="empty-state-title">No client deliverables in this period</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Revenue</th>
                <th>Jobs</th>
                <th>Effort Hours</th>
                <th>Team Involved</th>
                <th>Services Utilized</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.clientId}>
                  <td style={{ fontWeight: 700, color: 'var(--ci-navy)' }}>{c.name}</td>
                  <td style={{ fontWeight: 600 }}>₹{Number(c.revenue).toLocaleString('en-IN')}</td>
                  <td>{c.jobsCount}</td>
                  <td>{c.hours} hrs</td>
                  <td>{c.peopleInvolved.join(', ') || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {c.servicesUsed.map((svc, i) => (
                        <span key={i} className="badge badge-category">
                          {svc}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 9: BY PERSON
// ==========================================================================
function ProductivityByPersonTab({ persons }) {
  return (
    <div className="saas-card">
      <div className="card-header">
        <h2 className="card-title">Individual Contributor Productivity & Utilization</h2>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Duties</th>
              <th>Status</th>
              <th>Logged Hours</th>
              <th>Utilization</th>
              <th>Deliverables</th>
              <th>Revenue Credit</th>
              <th>Salary Grade</th>
              <th>Efficiency Multiplier</th>
            </tr>
          </thead>
          <tbody>
            {persons.map(p => {
              let badgeClass = 'badge-priority-low';
              if (p.utilizationStatus === 'overworked') badgeClass = 'badge-priority-urgent';
              else if (p.utilizationStatus === 'stretched') badgeClass = 'badge-priority-medium';
              else if (p.utilizationStatus === 'balanced') badgeClass = 'badge-status-completed';

              return (
                <tr key={p.userId}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ color: 'var(--ci-text-secondary)' }}>{p.duties}</td>
                  <td>
                    <span className="badge badge-status-submitted" style={{ textTransform: 'capitalize' }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.hours} hrs</td>
                  <td>
                    <span className={`badge ${badgeClass}`}>
                      {p.utilization}% ({p.utilizationStatus})
                    </span>
                  </td>
                  <td>{p.jobsCount}</td>
                  <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>
                    ₹{Number(p.revenueCredit).toLocaleString('en-IN')}
                  </td>
                  <td>{p.salaryGrade || '🔒 Private'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--ci-success)' }}>
                    {p.efficiency || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 10: ALL JOBS
// ==========================================================================
function ProductivityJobsTab({ jobs, canEdit, canDelete, onEditJob, onDeleteJob }) {
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');

  const filteredJobs = useMemo(() => {
    return (jobs || []).filter(j => {
      if (filterStatus === 'completed' && j.status !== 'Completed') return false;
      if (filterStatus === 'in_progress' && j.status !== 'In Progress') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const mClient = (j.clientName || '').toLowerCase().includes(q);
        const mDesc = (j.description || '').toLowerCase().includes(q);
        if (!mClient && !mDesc) return false;
      }
      return true;
    });
  }, [jobs, filterStatus, search]);

  const totalValue = useMemo(() => {
    return filteredJobs.reduce((sum, j) => sum + Number(j.valueAmount || 0), 0);
  }, [filteredJobs]);

  const totalHours = useMemo(() => {
    return filteredJobs.reduce((sum, j) => sum + Number(j.totalHours || 0), 0).toFixed(1);
  }, [filteredJobs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="filter-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', flex: 1, minWidth: '260px' }}>
          <div className="filter-search-box" style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="Search deliverables by client or description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="filter-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="all">All Deliverables ({jobs?.length || 0})</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {filteredJobs.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <span className="badge badge-category" style={{ padding: '6px 12px', fontSize: '13px' }}>
              Value: ₹{totalValue.toLocaleString('en-IN')}
            </span>
            <span className="badge badge-subtle" style={{ padding: '6px 12px', fontSize: '13px' }}>
              Total Hours: {totalHours}h
            </span>
          </div>
        )}
      </div>

      <div className="saas-card">
        <div className="data-table-container">
          {filteredJobs.length === 0 ? (
            <div className="empty-state-box">
              <p className="empty-state-title">No deliverables found</p>
              <p className="empty-state-desc">Try changing the search query, status filter, or period picker above.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Start Date</th>
                  <th>Status</th>
                  <th>Turnaround (TAT)</th>
                  <th>Client</th>
                  <th>Services</th>
                  <th>Description</th>
                  <th>Assigned Team</th>
                  <th>Value</th>
                  <th>Hours</th>
                  {(canEdit || canDelete) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map(j => (
                  <tr key={j.id}>
                    <td>{j.startDate}</td>
                    <td>
                      <span className={`badge ${j.status === 'Completed' ? 'badge-status-completed' : 'badge-status-in-progress'}`}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {j.tatDays != null ? (
                        <span className="badge badge-subtle">{j.tatDays} days</span>
                      ) : (
                        <span style={{ color: 'var(--ci-text-secondary)', fontSize: '12px' }}>Active</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{j.clientName}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {j.services.map(s => (
                          <span key={s.service_id} className="badge badge-category">
                            {s.service_name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ maxWidth: '200px', fontSize: '12.5px', color: 'var(--ci-text-secondary)' }}>
                      {j.description || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {j.assignments.map(a => (
                          <div key={a.id} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <strong>{a.user_name || a.external_name}</strong>
                            <span style={{ color: 'var(--ci-text-secondary)', fontSize: '11px' }}>({a.revenue_percent}%, {a.hours_spent}h)</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>
                      ₹{Number(j.valueAmount).toLocaleString('en-IN')}
                    </td>
                    <td style={{ fontWeight: 600 }}>{j.totalHours} hrs</td>
                    {(canEdit || canDelete) && (
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {canEdit && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onEditJob(j)}
                            >
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ color: 'var(--ci-danger)' }}
                              onClick={() => onDeleteJob(j.id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 11: SALARIES 🔒
// ==========================================================================
function ProductivitySalariesTab({ salaryData, employees, canManage, onReload }) {
  const { grades, assignments } = salaryData;

  const [employeeGradeMap, setEmployeeGradeMap] = useState(() => {
    const map = {};
    for (const a of assignments) {
      map[a.employee_user_id] = a.grade_id;
    }
    return map;
  });

  const handleGradeChange = async (empId, gradeId) => {
    setEmployeeGradeMap(prev => ({ ...prev, [empId]: gradeId }));
    await api.assignProductivitySalaryGrade(empId, gradeId);
    onReload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="alert-banner info">
        🔒 <strong>Salary Privacy Policy:</strong> Exact compensation amounts are strictly private and never exposed.
        Multipliers use grade bracket midpoints only for executive efficiency analytics.
      </div>

      {/* SALARY GRADES */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Salary Grade Brackets</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Grade Label</th>
                <th>Minimum Range</th>
                <th>Maximum Range</th>
                <th>Midpoint (Calculation Base)</th>
              </tr>
            </thead>
            <tbody>
              {grades.map(g => {
                const midpoint = (Number(g.min_amount) + Number(g.max_amount)) / 2;
                return (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 700 }}>{g.label}</td>
                    <td>₹{Number(g.min_amount).toLocaleString('en-IN')}</td>
                    <td>₹{Number(g.max_amount).toLocaleString('en-IN')}</td>
                    <td style={{ fontWeight: 600, color: 'var(--ci-navy)' }}>₹{midpoint.toLocaleString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* EMPLOYEE SALARY ASSIGNMENTS */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Employee Salary Grade Assignments</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Current Grade Assignment</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td>
                    <select
                      className="form-select"
                      style={{ width: '220px' }}
                      value={employeeGradeMap[emp.id] || ''}
                      onChange={e => handleGradeChange(emp.id, e.target.value)}
                      disabled={!canManage}
                    >
                      <option value="">Select Grade</option>
                      {grades.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.label} (₹{Number(g.min_amount).toLocaleString('en-IN')} - ₹{Number(g.max_amount).toLocaleString('en-IN')})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// TAB 12: MANAGE
// ==========================================================================
function ProductivityManageTab({ services, employees, onReload, onAddService, onEditService, onDeleteService }) {
  const [downloading, setDownloading] = useState(false);

  const handleCapacityUpdate = async (userId, hours, status) => {
    await api.updateProductivitySetting(userId, {
      weeklyCapacityHours: Number(hours),
      productivityStatus: status
    });
    onReload();
  };

  const handleExport = async () => {
    try {
      setDownloading(true);
      const data = await api.productivityExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `productivity_export_${new Date().toISOString().substring(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Failed to export');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* EXPORT BACKUP */}
      <div className="saas-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="card-title">Export Productivity Intelligence Data</h3>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Download complete backup of services, logs, rosters, and throughput configurations.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={downloading}
          onClick={handleExport}
        >
          {downloading ? 'Exporting...' : '📥 Export JSON Backup'}
        </button>
      </div>

      {/* EMPLOYEE CAPACITY SETTINGS */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Employee Weekly Capacity & Status</h3>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Weekly Capacity (Hours)</th>
                <th>Productivity Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td>{emp.department_name || 'General'}</td>
                  <td style={{ width: '160px' }}>
                    <input
                      type="number"
                      min="1"
                      className="form-control"
                      value={emp.weekly_capacity_hours}
                      onChange={e => handleCapacityUpdate(emp.id, e.target.value, emp.productivity_status)}
                    />
                  </td>
                  <td style={{ width: '160px' }}>
                    <select
                      className="form-select"
                      value={emp.productivity_status}
                      onChange={e => handleCapacityUpdate(emp.id, emp.weekly_capacity_hours, e.target.value)}
                    >
                      <option value="active">Active</option>
                      <option value="intern">Intern</option>
                      <option value="vendor">Vendor</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SERVICES CRUD */}
      <div className="saas-card">
        <div className="card-header">
          <h3 className="card-title">Productivity Services Catalog</h3>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAddService}>
            + Add Service
          </button>
        </div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service Name</th>
                <th>Reference Hours</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.reference_hours} hrs</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEditService(s)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: 'var(--ci-danger)' }}
                        onClick={() => onDeleteService(s.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// MODALS
// ==========================================================================
function EditRosterModal({ roster, employees, onClose, onSaved }) {
  const [nature, setNature] = useState(roster?.nature || 'Existing');
  const [difficulty, setDifficulty] = useState(roster?.difficulty || 5);
  const [comments, setComments] = useState(roster?.comments || '');
  const [assignments, setAssignments] = useState(() => {
    const map = {};
    for (const rk of responsibilityKeys) {
      map[rk.key] = roster?.assignments?.[rk.key]?.userId || '';
    }
    return map;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      const asgnPayload = {};
      for (const rk of responsibilityKeys) {
        if (assignments[rk.key]) {
          asgnPayload[rk.key] = {
            userId: assignments[rk.key],
            assigneeType: 'employee'
          };
        }
      }
      await api.saveProductivityAccount({
        clientId: roster.clientId,
        nature,
        difficulty: Number(difficulty),
        comments,
        assignments: asgnPayload
      });
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '720px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Account Roster: {roster.clientName}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Account Nature</label>
                <select className="form-select" value={nature} onChange={e => setNature(e.target.value)}>
                  <option value="Existing">Existing</option>
                  <option value="Prospect">Prospect</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Difficulty Score (1 to 10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="form-control"
                  value={difficulty}
                  onChange={e => setDifficulty(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Account Comments / Context</label>
              <textarea
                className="form-textarea"
                value={comments}
                onChange={e => setComments(e.target.value)}
              />
            </div>

            <h4 style={{ fontSize: '14px', fontWeight: 600, marginTop: '16px', marginBottom: '12px' }}>
              Responsibility Ownership
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {responsibilityKeys.map(rk => (
                <div key={rk.key} className="form-group" style={{ marginBottom: '8px' }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>{rk.label}</label>
                  <select
                    className="form-select"
                    value={assignments[rk.key] || ''}
                    onChange={e => setAssignments({ ...assignments, [rk.key]: e.target.value })}
                  >
                    <option value="">Unassigned (—)</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Roster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReassignAccountsModal({ employees, onClose, onReassigned }) {
  const [fromUserId, setFromUserId] = useState(employees[0]?.id || '');
  const [toUserId, setToUserId] = useState(employees[1]?.id || employees[0]?.id || '');
  const [markInactive, setMarkInactive] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleReassign = async e => {
    e.preventDefault();
    if (fromUserId === toUserId) return alert('Select different team members');
    try {
      setSaving(true);
      await api.reassignProductivityAccounts({ fromUserId, toUserId, markInactive });
      alert('All accounts successfully reassigned!');
      onReassigned();
    } catch (err) {
      alert(err.message || 'Failed to reassign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Bulk Reassign Accounts</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleReassign}>
          <div className="modal-body">
            <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', marginBottom: '16px' }}>
              Transfers all standing roster responsibilities from one contributor to another across all client accounts in a single atomic transaction.
            </p>

            <div className="form-group">
              <label className="form-label">Transfer FROM</label>
              <select className="form-select" value={fromUserId} onChange={e => setFromUserId(e.target.value)}>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Transfer TO</label>
              <select className="form-select" value={toUserId} onChange={e => setToUserId(e.target.value)}>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>

            <div className="auth-remember-row" style={{ marginTop: '12px' }}>
              <label className="auth-remember-label">
                <input
                  type="checkbox"
                  checked={markInactive}
                  onChange={e => setMarkInactive(e.target.checked)}
                />
                <span>Mark departing team member as inactive</span>
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Transferring...' : 'Execute Reassignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TargetFormModal({ target, employees, services, onClose, onSaved }) {
  const [userId, setUserId] = useState(target?.user_id || employees[0]?.id || '');
  const [serviceId, setServiceId] = useState(target?.service_id || '');
  const [quantity, setQuantity] = useState(target?.quantity || 1);
  const [unit, setUnit] = useState(target?.unit || 'count');
  const [period, setPeriod] = useState(target?.period || 'week');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      await api.saveProductivityTarget({
        userId,
        serviceId: serviceId ? Number(serviceId) : null,
        quantity: Number(quantity),
        unit,
        period
      }, target?.id);
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{target ? 'Edit Target' : 'Set Throughput Target'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Employee</label>
              <select className="form-select" value={userId} onChange={e => setUserId(e.target.value)}>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Service Focus (optional)</label>
              <select className="form-select" value={serviceId} onChange={e => setServiceId(e.target.value)}>
                <option value="">All Services</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Target Quantity</label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  className="form-control"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Unit</label>
                <select className="form-select" value={unit} onChange={e => setUnit(e.target.value)}>
                  <option value="count">Pieces / Deliverables</option>
                  <option value="hours">Hours</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Target Period</label>
              <select className="form-select" value={period} onChange={e => setPeriod(e.target.value)}>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Target'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ServiceFormModal({ service, onClose, onSaved }) {
  const [name, setName] = useState(service?.name || '');
  const [referenceHours, setReferenceHours] = useState(service?.reference_hours || 10);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      await api.saveProductivityService({ name, referenceHours: Number(referenceHours) }, service?.id);
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{service ? 'Edit Service' : 'Add Productivity Service'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Service Name</label>
              <input
                type="text"
                className="form-control"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Standard Reference Hours</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                className="form-control"
                value={referenceHours}
                onChange={e => setReferenceHours(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditJobModal({ job, clients, services, employees, onClose, onSaved }) {
  const [clientId, setClientId] = useState(job.clientId);
  const [startDate, setStartDate] = useState(job.startDate);
  const [completionDate, setCompletionDate] = useState(job.completionDate || '');
  const [valueAmount, setValueAmount] = useState(job.valueAmount);
  const [description, setDescription] = useState(job.description || '');
  const [selectedServiceIds, setSelectedServiceIds] = useState(job.services.map(s => s.service_id));
  const [assignments, setAssignments] = useState(job.assignments.map(a => ({
    userId: a.user_id,
    revenuePercent: a.revenue_percent,
    hoursSpent: a.hours_spent
  })));
  const [saving, setSaving] = useState(false);

  const totalRevPercent = assignments.reduce((sum, a) => sum + Number(a.revenuePercent || 0), 0);

  const toggleService = id => {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const addPerson = () => {
    setAssignments(prev => [
      ...prev,
      { userId: employees[0]?.id || '', revenuePercent: 0, hoursSpent: '' }
    ]);
  };

  const updateAssignment = (index, field, val) => {
    setAssignments(prev =>
      prev.map((a, i) => (i === index ? { ...a, [field]: val } : a))
    );
  };

  const removeAssignment = index => {
    setAssignments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (selectedServiceIds.length === 0) return alert('Select at least one service');
    if (totalRevPercent !== 100) return alert(`Revenue allocation must equal 100% (currently ${totalRevPercent}%)`);

    try {
      setSaving(true);
      await api.updateProductivityJob(job.id, {
        clientId,
        startDate,
        completionDate: completionDate || null,
        valueAmount: Number(valueAmount || 0),
        description,
        serviceIds: selectedServiceIds,
        assignments: assignments.map(a => ({
          userId: a.userId,
          revenuePercent: Number(a.revenuePercent || 0),
          hoursSpent: Number(a.hoursSpent || 0)
        }))
      });
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to update job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '780px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit Deliverable #{job.id}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Client</label>
                <select className="form-select" value={clientId} onChange={e => setClientId(e.target.value)}>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Job Value (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="form-control"
                  value={valueAmount}
                  onChange={e => setValueAmount(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Completion Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={completionDate}
                  onChange={e => setCompletionDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Services Attached</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {services.map(s => {
                  const isSelected = selectedServiceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => toggleService(s.id)}
                    >
                      {isSelected ? '✓ ' : '+ '} {s.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0 }}>Team Allocations</label>
                <span style={{ fontSize: '12px', fontWeight: 600, color: totalRevPercent === 100 ? 'var(--ci-success)' : 'var(--ci-danger)' }}>
                  {totalRevPercent}% allocated
                </span>
              </div>

              {assignments.map((a, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', marginBottom: '8px' }}>
                  <select
                    className="form-select"
                    value={a.userId}
                    onChange={e => updateAssignment(i, 'userId', e.target.value)}
                  >
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="form-control"
                    placeholder="Rev %"
                    value={a.revenuePercent}
                    onChange={e => updateAssignment(i, 'revenuePercent', Number(e.target.value))}
                  />

                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className="form-control"
                    placeholder="Hours"
                    value={a.hoursSpent}
                    onChange={e => updateAssignment(i, 'hoursSpent', e.target.value)}
                  />

                  {assignments.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeAssignment(i)}>✕</button>
                  )}
                </div>
              ))}

              <button type="button" className="btn btn-secondary btn-sm" onClick={addPerson}>+ Add Person</button>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Updating...' : 'Update Deliverable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
