import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from './api';

const statusBadgeClass = (status) => {
  switch (status?.toLowerCase()) {
    case 'active': return 'badge-status-completed';
    case 'intern': return 'badge-category';
    case 'vendor': return 'badge-priority-urgent';
    case 'inactive': return 'badge-status-cancelled';
    default: return 'badge-subtle';
  }
};

const initialsFor = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function ManageEmployees({ data, reload, setTab }) {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rosters, setRosters] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters & View
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const canManage = (data.permissions || []).includes('employees.create') ||
                    (data.permissions || []).includes('employees.edit') ||
                    (data.permissions || []).includes('users.create') ||
                    (data.permissions || []).includes('users.edit') ||
                    ['super_admin', 'admin'].includes(data.user?.accountType || data.user?.role);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [uRes, dRes, dsRes, rRes, rostRes] = await Promise.all([
        api.users().catch(() => ({ users: [] })),
        api.departments().catch(() => ({ departments: [] })),
        api.designations().catch(() => ({ designations: [] })),
        api.roles().catch(() => ({ roles: [] })),
        api.productivityAccounts().catch(() => ({ accounts: [] }))
      ]);

      setUsers(uRes.users || []);
      setDepartments(dRes.departments || []);
      setDesignations(dsRes.designations || []);
      setRoles(rRes.roles || []);
      setRosters(rostRes || null);
    } catch (err) {
      setError(err.message || 'Failed to load employee data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showNotification = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Filter internal employees/admins (exclude client accounts from the employee directory)
  const employees = useMemo(() => {
    return users.filter(u => u.accountType !== 'client' && u.role !== 'client');
  }, [users]);

  // Roster Accounts mapped by User ID or Name
  const userRostersMap = useMemo(() => {
    const map = {};
    if (rosters && rosters.accounts) {
      for (const acc of rosters.accounts) {
        if (acc.assignments) {
          for (const asgn of acc.assignments) {
            const uId = asgn.userId;
            const uName = asgn.userName || asgn.externalName;
            const key = uId || (uName ? uName.toLowerCase() : null);
            if (key) {
              if (!map[key]) map[key] = new Set();
              map[key].add(acc.clientName);
            }
          }
        }
      }
    }
    return map;
  }, [rosters]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      // Status filter
      const pStatus = emp.productivityStatus || (emp.status === 'active' ? 'active' : 'inactive');
      if (statusFilter !== 'all' && pStatus.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      // Department filter
      if (departmentFilter !== 'all') {
        if (String(emp.departmentId) !== String(departmentFilter) && (emp.departmentName || '').toLowerCase() !== departmentFilter.toLowerCase()) {
          return false;
        }
      }
      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const mName = (emp.name || '').toLowerCase().includes(q);
        const mEmail = (emp.email || '').toLowerCase().includes(q);
        const mDuties = (emp.customDuties || '').toLowerCase().includes(q);
        const mDesig = (emp.designationName || emp.roleName || '').toLowerCase().includes(q);
        const mDept = (emp.departmentName || '').toLowerCase().includes(q);
        if (!mName && !mEmail && !mDuties && !mDesig && !mDept) return false;
      }
      return true;
    });
  }, [employees, search, departmentFilter, statusFilter]);

  // Metric summaries
  const totalEmployees = employees.length;
  const activeCount = employees.filter(e => (e.productivityStatus || e.status) === 'active').length;
  const internCount = employees.filter(e => (e.productivityStatus || '').toLowerCase() === 'intern').length;
  const totalCapacity = employees.reduce((sum, e) => sum + Number(e.weeklyCapacityHours || 48), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* 4 SUMMARY METRIC CARDS */}
      <div className="metrics-2x2-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="metric-box">
          <span className="metric-title">Total Personnel</span>
          <span className="metric-number" style={{ color: 'var(--ci-navy)' }}>{totalEmployees}</span>
          <span className="metric-subtext">Internal team & specialist directory</span>
        </div>

        <div className="metric-box" style={{ borderLeft: '4px solid var(--ci-success)' }}>
          <span className="metric-title">Active Staff</span>
          <span className="metric-number" style={{ color: 'var(--ci-success)' }}>{activeCount}</span>
          <span className="metric-subtext">Full capacity contributors</span>
        </div>

        <div className="metric-box" style={{ borderLeft: '4px solid var(--ci-accent)' }}>
          <span className="metric-title">Interns & Support</span>
          <span className="metric-number" style={{ color: 'var(--ci-accent)' }}>{internCount}</span>
          <span className="metric-subtext">Operational learning track</span>
        </div>

        <div className="metric-box" style={{ borderLeft: '4px solid var(--ci-gold)' }}>
          <span className="metric-title">Total Weekly Capacity</span>
          <span className="metric-number" style={{ color: 'var(--ci-gold)' }}>{totalCapacity} hrs</span>
          <span className="metric-subtext">Org-wide operational bandwidth</span>
        </div>
      </div>

      {successMsg && <div className="alert-banner success">{successMsg}</div>}
      {error && <div className="alert-banner error">{error}</div>}

      {/* TOOLBAR: SEARCH, FILTERS & ACTIONS */}
      <div className="saas-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', flex: 1, minWidth: '280px', flexWrap: 'wrap' }}>
            <div className="filter-search-box" style={{ flex: 1, minWidth: '220px' }}>
              <input
                type="text"
                placeholder="Search by employee name, role, email, or duties..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select
              className="filter-select"
              value={departmentFilter}
              onChange={e => setDepartmentFilter(e.target.value)}
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <select
              className="filter-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="intern">Intern</option>
              <option value="vendor">Vendor / External</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* View Mode Toggle */}
            <div className="prod-period-pills" style={{ display: 'flex', padding: '2px', background: 'var(--ci-border-subtle)', borderRadius: '6px' }}>
              <button
                type="button"
                className={`prod-period-btn ${viewMode === 'cards' ? 'active' : ''}`}
                style={{ padding: '5px 10px', fontSize: '12px' }}
                onClick={() => setViewMode('cards')}
                title="Grid Card View"
              >
                🗂️ Cards
              </button>
              <button
                type="button"
                className={`prod-period-btn ${viewMode === 'table' ? 'active' : ''}`}
                style={{ padding: '5px 10px', fontSize: '12px' }}
                onClick={() => setViewMode('table')}
                title="Table List View"
              >
                📋 Table
              </button>
            </div>

            {canManage && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditingEmployee(null);
                  setShowModal(true);
                }}
              >
                + Add Employee
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CONTENT: CARDS GRID OR TABLE */}
      {loading && !employees.length ? (
        <div className="saas-card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--ci-text-secondary)' }}>Loading employee directory...</p>
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="saas-card">
          <div className="empty-state-box">
            <p className="empty-state-title">No employees matched your filters</p>
            <p className="empty-state-desc">Try clearing the search query or adjusting the department and status filters.</p>
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARD GRID VIEW */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
          {filteredEmployees.map(emp => {
            const pStatus = emp.productivityStatus || (emp.status === 'active' ? 'active' : 'inactive');
            const rosterList = Array.from(userRostersMap[emp.id] || userRostersMap[(emp.name || '').toLowerCase()] || []);

            return (
              <div
                key={emp.id}
                className="saas-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '20px',
                  borderTop: `4px solid ${pStatus === 'active' ? 'var(--ci-navy)' : pStatus === 'intern' ? 'var(--ci-accent)' : pStatus === 'vendor' ? 'var(--ci-gold)' : '#98A2B3'}`
                }}
              >
                {/* TOP PROFILE ROW */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      className="user-avatar-circle"
                      style={{
                        width: '46px',
                        height: '46px',
                        fontSize: '16px',
                        background: 'var(--ci-navy)',
                        color: '#fff',
                        fontWeight: 700
                      }}
                    >
                      {initialsFor(emp.name)}
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ci-text)' }}>
                        {emp.name}
                      </h3>
                      <span style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', display: 'block' }}>
                        {emp.designationName || emp.roleName || (emp.role === 'admin' ? 'Administrator' : 'Team Member')}
                      </span>
                    </div>
                  </div>

                  <span className={`badge ${statusBadgeClass(pStatus)}`} style={{ textTransform: 'capitalize' }}>
                    {pStatus}
                  </span>
                </div>

                {/* DEPARTMENT & CAPACITY PILLS */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '12px' }}>
                  <span className="badge badge-category">
                    🏢 {emp.departmentName || 'General'}
                  </span>
                  <span className="badge badge-subtle">
                    ⏱️ {emp.weeklyCapacityHours || 48} hrs/wk
                  </span>
                  {emp.activeJobsCount > 0 && (
                    <span className="badge badge-priority-medium">
                      ⚡ {emp.activeJobsCount} Active Jobs
                    </span>
                  )}
                </div>

                {/* DUTIES & RESPONSIBILITIES */}
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'var(--ci-surface)',
                  border: '1px solid var(--ci-border)',
                  fontSize: '12.5px',
                  lineHeight: '1.45',
                  color: 'var(--ci-text)'
                }}>
                  <strong style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--ci-text-secondary)', marginBottom: '3px' }}>
                    Duties & Responsibilities:
                  </strong>
                  {emp.customDuties || 'Core functional responsibilities and deliverable execution.'}
                </div>

                {/* ASSIGNED CLIENT ROSTERS */}
                {rosterList.length > 0 && (
                  <div>
                    <strong style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--ci-text-secondary)', marginBottom: '4px' }}>
                      Assigned Client Accounts ({rosterList.length}):
                    </strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {rosterList.slice(0, 5).map((clientName, idx) => (
                        <span key={idx} className="badge badge-subtle" style={{ fontSize: '11px' }}>
                          {clientName}
                        </span>
                      ))}
                      {rosterList.length > 5 && (
                        <span className="badge badge-subtle" style={{ fontSize: '11px' }}>
                          +{rosterList.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* FOOTER: EMAIL & EDIT ACTION */}
                <div style={{
                  marginTop: 'auto',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--ci-border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '12px',
                  color: 'var(--ci-text-secondary)'
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                    ✉️ {emp.email || 'No email set'}
                  </span>

                  {canManage && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingEmployee(emp);
                        setShowModal(true);
                      }}
                    >
                      Edit Profile
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE LIST VIEW */
        <div className="saas-card">
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department & Designation</th>
                  <th>Status</th>
                  <th>Weekly Capacity</th>
                  <th>Duties & Responsibilities</th>
                  <th>Assigned Accounts</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map(emp => {
                  const pStatus = emp.productivityStatus || (emp.status === 'active' ? 'active' : 'inactive');
                  const rosterList = Array.from(userRostersMap[emp.id] || userRostersMap[(emp.name || '').toLowerCase()] || []);

                  return (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div className="user-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                            {initialsFor(emp.name)}
                          </div>
                          <div>
                            <strong style={{ display: 'block', color: 'var(--ci-text)' }}>{emp.name}</strong>
                            <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>{emp.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, display: 'block' }}>{emp.departmentName || 'General'}</span>
                        <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>
                          {emp.designationName || emp.roleName || 'Team Member'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${statusBadgeClass(pStatus)}`} style={{ textTransform: 'capitalize' }}>
                          {pStatus}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {emp.weeklyCapacityHours || 48} hrs/wk
                      </td>
                      <td style={{ maxWidth: '280px', fontSize: '12.5px', color: 'var(--ci-text-secondary)' }}>
                        {emp.customDuties || '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxWidth: '180px' }}>
                          {rosterList.length === 0 ? (
                            <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>—</span>
                          ) : (
                            rosterList.slice(0, 3).map((cName, idx) => (
                              <span key={idx} className="badge badge-subtle" style={{ fontSize: '10.5px' }}>
                                {cName}
                              </span>
                            ))
                          )}
                          {rosterList.length > 3 && (
                            <span className="badge badge-subtle" style={{ fontSize: '10.5px' }}>
                              +{rosterList.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingEmployee(emp);
                              setShowModal(true);
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {showModal && (
        <EmployeeModal
          employee={editingEmployee}
          departments={departments}
          designations={designations}
          roles={roles}
          onClose={() => setShowModal(false)}
          onSaved={(msg) => {
            setShowModal(false);
            showNotification(msg);
            loadData();
            reload();
          }}
        />
      )}
    </div>
  );
}

// ==========================================================================
// ADD / EDIT EMPLOYEE MODAL
// ==========================================================================
function EmployeeModal({ employee, departments, designations, roles, onClose, onSaved }) {
  const isEditing = Boolean(employee);

  const [id, setId] = useState(employee?.id || '');
  const [name, setName] = useState(employee?.name || '');
  const [email, setEmail] = useState(employee?.email || '');
  const [phone, setPhone] = useState(employee?.phone || '');
  const [password, setPassword] = useState('');
  const [departmentId, setDepartmentId] = useState(employee?.departmentId || '');
  const [designationId, setDesignationId] = useState(employee?.designationId || '');
  const [roleId, setRoleId] = useState(employee?.roleId || (employee?.role === 'admin' ? 'admin' : 'employee'));
  const [productivityStatus, setProductivityStatus] = useState(employee?.productivityStatus || 'active');
  const [weeklyCapacityHours, setWeeklyCapacityHours] = useState(employee?.weeklyCapacityHours || 48);
  const [customDuties, setCustomDuties] = useState(employee?.customDuties || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Employee name is required');
      return;
    }
    if (!isEditing && !id.trim()) {
      setError('User ID / Login ID is required');
      return;
    }
    if (!isEditing && !password.trim()) {
      setError('A password of at least 8 characters is required');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (isEditing) {
        // 1. Update user record
        await api.updateUser(employee.id, {
          name,
          email: email || undefined,
          phone: phone || undefined,
          roleId: roleId || undefined,
          departmentId: departmentId ? Number(departmentId) : null,
          designationId: designationId ? Number(designationId) : null,
          password: password ? password : undefined
        });

        // 2. Update employee productivity settings (capacity & duties)
        await api.updateProductivitySetting(employee.id, {
          weeklyCapacityHours: Number(weeklyCapacityHours) || 48,
          customDuties,
          productivityStatus
        });

        onSaved(`Employee ${name} updated successfully`);
      } else {
        // Create new user
        const newUserId = id.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
        await api.createUser({
          id: newUserId,
          name,
          email: email || undefined,
          phone: phone || undefined,
          password,
          accountType: roleId === 'admin' ? 'admin' : 'employee',
          roleId: roleId || 'employee',
          departmentId: departmentId ? Number(departmentId) : null,
          designationId: designationId ? Number(designationId) : null
        });

        // Set employee productivity settings
        await api.updateProductivitySetting(newUserId, {
          weeklyCapacityHours: Number(weeklyCapacityHours) || 48,
          customDuties,
          productivityStatus
        });

        onSaved(`Employee ${name} added successfully`);
      }
    } catch (err) {
      setError(err.message || 'Failed to save employee profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h3 className="modal-title">{isEditing ? `Edit Employee: ${employee.name}` : 'Add New Employee'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert-banner error" style={{ margin: '12px 20px 0' }}>{error}</div>}

        <form onSubmit={handleSave} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '14px' }}>
            {/* Full Name */}
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Urna, Mansi, John"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            {/* Login / User ID */}
            <div className="form-group">
              <label className="form-label">User ID / Username *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. urna, mansi"
                value={id}
                onChange={e => setId(e.target.value)}
                disabled={isEditing}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '14px' }}>
            {/* Email */}
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-control"
                placeholder="e.g. urna@360degrees.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            {/* Phone */}
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '14px' }}>
            {/* Department */}
            <div className="form-group">
              <label className="form-label">Department</label>
              <select
                className="form-control"
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
              >
                <option value="">Select Department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Designation */}
            <div className="form-group">
              <label className="form-label">Designation / Role Title</label>
              <select
                className="form-control"
                value={designationId}
                onChange={e => setDesignationId(e.target.value)}
              >
                <option value="">Select Designation</option>
                {designations.map(ds => (
                  <option key={ds.id} value={ds.id}>{ds.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            {/* Status */}
            <div className="form-group">
              <label className="form-label">Productivity Status</label>
              <select
                className="form-control"
                value={productivityStatus}
                onChange={e => setProductivityStatus(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="intern">Intern</option>
                <option value="vendor">Vendor / External</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {/* Weekly Capacity Hours */}
            <div className="form-group">
              <label className="form-label">Weekly Capacity (Hours)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                className="form-control"
                value={weeklyCapacityHours}
                onChange={e => setWeeklyCapacityHours(e.target.value)}
              />
            </div>

            {/* RBAC Role */}
            <div className="form-group">
              <label className="form-label">Access Role</label>
              <select
                className="form-control"
                value={roleId}
                onChange={e => setRoleId(e.target.value)}
              >
                {roles.filter(r => r.role_type !== 'client').map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Custom Duties & Responsibilities */}
          <div className="form-group">
            <label className="form-label">Duties & Functional Responsibilities</label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="e.g. Founder, Strategy, BD, Content Management, Quality Control, Website Support..."
              value={customDuties}
              onChange={e => setCustomDuties(e.target.value)}
            />
          </div>

          {/* Password (Optional on edit) */}
          <div className="form-group">
            <label className="form-label">{isEditing ? 'Change Password (leave blank to keep current)' : 'Password *'}</label>
            <input
              type="password"
              className="form-control"
              placeholder={isEditing ? 'Enter new password if updating' : 'Min 8 characters'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required={!isEditing}
            />
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
