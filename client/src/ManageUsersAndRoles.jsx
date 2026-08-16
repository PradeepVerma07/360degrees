import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from './api';

const permissionGroups = [
  {
    category: 'Dashboard & Navigation',
    permissions: [
      { id: 'dashboard.view', label: 'View Dashboard & Overview Metrics' }
    ]
  },
  {
    category: 'Jobs & Delivery',
    permissions: [
      { id: 'jobs.view_all', label: 'View All Jobs across Organization' },
      { id: 'jobs.view_own', label: 'View Own / Assigned Jobs' },
      { id: 'jobs.view_department', label: 'View Department Jobs' },
      { id: 'jobs.create', label: 'Submit / Create New Jobs' },
      { id: 'jobs.edit', label: 'Edit Job Details & Scope' },
      { id: 'jobs.assign', label: 'Assign Team Members to Jobs' },
      { id: 'jobs.reassign', label: 'Reassign Jobs Between Users' },
      { id: 'jobs.update_status', label: 'Update Job Status & Deliverables' },
      { id: 'jobs.override_tat', label: 'Override Calculated Turnaround (TAT) Hours' }
    ]
  },
  {
    category: 'Clients & Accounts',
    permissions: [
      { id: 'clients.view_all', label: 'View All Client Accounts' },
      { id: 'clients.view', label: 'View Assigned Clients' },
      { id: 'clients.create', label: 'Create New Client Accounts' },
      { id: 'clients.edit', label: 'Edit Client Profiles & Settings' },
      { id: 'clients.delete', label: 'Archive / Delete Clients' },
      { id: 'clients.assign_owner', label: 'Assign Account Owners' }
    ]
  },
  {
    category: 'Employees & Organization',
    permissions: [
      { id: 'employees.view', label: 'View Employee Directory' },
      { id: 'employees.create', label: 'Add New Employees' },
      { id: 'employees.edit', label: 'Edit Employee Information' },
      { id: 'departments.manage', label: 'Manage Departments' },
      { id: 'designations.manage', label: 'Manage Designations & Hierarchy' }
    ]
  },
  {
    category: 'Users & Access Control (RBAC)',
    permissions: [
      { id: 'users.view', label: 'View User Accounts' },
      { id: 'users.create', label: 'Create User Accounts & Credentials' },
      { id: 'users.edit', label: 'Edit User Accounts & Status' },
      { id: 'users.assign_role', label: 'Assign Roles to Users' },
      { id: 'roles.view', label: 'View Roles & Access Policies' },
      { id: 'roles.create', label: 'Create New Custom Roles' },
      { id: 'roles.edit', label: 'Edit Role Definitions' },
      { id: 'roles.manage_permissions', label: 'Modify Permissions per Role' }
    ]
  },
  {
    category: 'Support Tickets',
    permissions: [
      { id: 'support.view_all', label: 'View All Support Tickets' },
      { id: 'support.view_own', label: 'View Own Support Tickets' },
      { id: 'support.create', label: 'Raise New Support Tickets' },
      { id: 'support.reply', label: 'Reply & Send Ticket Messages' },
      { id: 'support.assign', label: 'Assign Tickets to Support Staff' },
      { id: 'support.manage', label: 'Manage, Status & Delete Tickets' }
    ]
  },
  {
    category: 'Team Chat',
    permissions: [
      { id: 'chat.view', label: 'Access Team Chat & View Channels' },
      { id: 'chat.send', label: 'Send Messages & Upload Files' },
      { id: 'chat.manage', label: 'Create Channels & Moderate Chat' }
    ]
  },
  {
    category: 'System & Standards Settings',
    permissions: [
      { id: 'settings.view', label: 'View Turnaround Standards & Settings' },
      { id: 'settings.edit', label: 'Modify Operating Hours & TAT Settings' }
    ]
  },
  {
    category: 'Productivity Intelligence',
    permissions: [
      { id: 'productivity.view', label: 'Access Productivity Intelligence Module' },
      { id: 'productivity.dashboard.view', label: 'View Executive Productivity Dashboard' },
      { id: 'productivity.analysis.view', label: 'View Trajectory & Roadmap Analysis' },
      { id: 'productivity.accounts.view', label: 'View Standing Account Rosters' },
      { id: 'productivity.accounts.manage', label: 'Edit Rosters & Reassign Accounts' },
      { id: 'productivity.targets.view', label: 'View Throughput Quota Targets' },
      { id: 'productivity.targets.manage', label: 'Create, Edit & Delete Targets' },
      { id: 'productivity.reports.view', label: 'View Comparative Reports (MTD/YTD)' },
      { id: 'productivity.jobs.view', label: 'View Logged Productivity Jobs' },
      { id: 'productivity.jobs.create', label: 'Log New Productivity Jobs' },
      { id: 'productivity.jobs.edit', label: 'Edit Logged Productivity Jobs' },
      { id: 'productivity.jobs.delete', label: 'Delete Productivity Work Records' },
      { id: 'productivity.daily_log.view', label: 'View Daily Effort Logs' },
      { id: 'productivity.by_client.view', label: 'View Effort Performance By Client' },
      { id: 'productivity.by_person.view', label: 'View Effort Performance By Person' },
      { id: 'productivity.salaries.view', label: 'View Confidential Salary Multipliers' },
      { id: 'productivity.salaries.manage', label: 'Manage Salary Grades & Assignments' },
      { id: 'productivity.services.manage', label: 'Manage Productivity Services Catalog' },
      { id: 'productivity.settings.manage', label: 'Configure Employee Capacity & Status' },
      { id: 'productivity.export', label: 'Export Productivity Intelligence Data' }
    ]
  },
  {
    category: 'Audit & Compliance',
    permissions: [
      { id: 'audit.view', label: 'View System Audit Logs & Trail' }
    ]
  }
];

export default function ManageUsersAndRoles({ data, reload }) {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modals
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [showDepartmentModal, setShowDepartmentModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [showDesignationModal, setShowDesignationModal] = useState(false);
  const [editingDesignation, setEditingDesignation] = useState(null);
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  const isSuperAdmin = data.user?.accountType === 'super_admin';

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [uRes, rRes, dRes, dsRes, aRes] = await Promise.all([
        api.users().catch(() => ({ users: [] })),
        api.roles().catch(() => ({ roles: [] })),
        api.departments().catch(() => ({ departments: [] })),
        api.designations().catch(() => ({ designations: [] })),
        api.auditLogs().catch(() => ({ logs: [] }))
      ]);

      setUsers(uRes.users || []);
      setRoles(rRes.roles || []);
      setDepartments(dRes.departments || []);
      setDesignations(dsRes.designations || []);
      setAuditLogs(aRes.logs || []);
    } catch (err) {
      setError(err.message || 'Failed to load user management data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showNotification = msg => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* SUB NAVIGATION TABS */}
      <div className="saas-card" style={{ padding: '14px 20px' }}>
        <div className="prod-subnav-list">
          <button
            type="button"
            className={`prod-subnav-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 User Accounts ({users.length})
          </button>
          <button
            type="button"
            className={`prod-subnav-btn ${activeTab === 'roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('roles')}
          >
            🛡️ Roles & Permissions ({roles.length})
          </button>
          <button
            type="button"
            className={`prod-subnav-btn ${activeTab === 'departments' ? 'active' : ''}`}
            onClick={() => setActiveTab('departments')}
          >
            🏢 Departments & Designations
          </button>
          <button
            type="button"
            className={`prod-subnav-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            📋 Audit Trail ({auditLogs.length})
          </button>
        </div>
      </div>

      {successMsg && <div className="alert-banner success">{successMsg}</div>}
      {error && <div className="alert-banner error">{error}</div>}

      {/* TAB 1: USERS */}
      {activeTab === 'users' && (
        <UsersListPanel
          users={users}
          roles={roles}
          departments={departments}
          designations={designations}
          currentUser={data.user}
          isSuperAdmin={isSuperAdmin}
          onAddUser={() => {
            setEditingUser(null);
            setShowUserModal(true);
          }}
          onEditUser={u => {
            setEditingUser(u);
            setShowUserModal(true);
          }}
          onToggleStatus={async u => {
            const newStatus = u.status === 'active' ? 'inactive' : 'active';
            await api.updateUser(u.id, { status: newStatus });
            showNotification(`User ${u.name} marked as ${newStatus}.`);
            loadAll();
            reload();
          }}
        />
      )}

      {/* TAB 2: ROLES & RBAC */}
      {activeTab === 'roles' && (
        <RolesAndPermissionsPanel
          roles={roles}
          isSuperAdmin={isSuperAdmin}
          onEditRole={r => {
            setEditingRole(r);
            setShowRoleModal(true);
          }}
          onAddRole={() => {
            setEditingRole(null);
            setShowRoleModal(true);
          }}
          onReload={loadAll}
          showNotification={showNotification}
        />
      )}

      {/* TAB 3: DEPARTMENTS & DESIGNATIONS */}
      {activeTab === 'departments' && (
        <DepartmentsAndDesignationsPanel
          departments={departments}
          designations={designations}
          users={users}
          onAddDepartment={() => {
            setEditingDepartment(null);
            setShowDepartmentModal(true);
          }}
          onEditDepartment={d => {
            setEditingDepartment(d);
            setShowDepartmentModal(true);
          }}
          onAddDesignation={() => {
            setEditingDesignation(null);
            setShowDesignationModal(true);
          }}
          onEditDesignation={ds => {
            setEditingDesignation(ds);
            setShowDesignationModal(true);
          }}
          onReload={loadAll}
          showNotification={showNotification}
        />
      )}

      {/* TAB 4: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <AuditLogsPanel
          logs={auditLogs}
          onViewDetails={setSelectedAuditLog}
        />
      )}

      {/* MODALS */}
      {showUserModal && (
        <UserFormModal
          user={editingUser}
          roles={roles}
          departments={departments}
          designations={designations}
          allUsers={users}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setShowUserModal(false)}
          onSaved={() => {
            setShowUserModal(false);
            showNotification(editingUser ? 'User updated successfully.' : 'New user created successfully.');
            loadAll();
            reload();
          }}
        />
      )}

      {showRoleModal && (
        <RoleFormModal
          role={editingRole}
          onClose={() => setShowRoleModal(false)}
          onSaved={() => {
            setShowRoleModal(false);
            showNotification('Role permissions saved successfully.');
            loadAll();
            reload();
          }}
        />
      )}

      {showDepartmentModal && (
        <DepartmentFormModal
          department={editingDepartment}
          onClose={() => setShowDepartmentModal(false)}
          onSaved={() => {
            setShowDepartmentModal(false);
            showNotification('Department saved successfully.');
            loadAll();
          }}
        />
      )}

      {showDesignationModal && (
        <DesignationFormModal
          designation={editingDesignation}
          onClose={() => setShowDesignationModal(false)}
          onSaved={() => {
            setShowDesignationModal(false);
            showNotification('Designation saved successfully.');
            loadAll();
          }}
        />
      )}

      {selectedAuditLog && (
        <AuditDetailModal
          log={selectedAuditLog}
          onClose={() => setSelectedAuditLog(null)}
        />
      )}
    </div>
  );
}

// ==========================================================================
// USERS LIST PANEL
// ==========================================================================
function UsersListPanel({ users, roles, departments, designations, currentUser, isSuperAdmin, onAddUser, onEditUser, onToggleStatus }) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (roleFilter !== 'all' && u.roleId !== roleFilter && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const mName = (u.name || '').toLowerCase().includes(q);
        const mEmail = (u.email || '').toLowerCase().includes(q);
        const mDept = (u.departmentName || '').toLowerCase().includes(q);
        if (!mName && !mEmail && !mDept) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>User Accounts Directory</h2>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Manage staff credentials, assigned roles, departments, and operational access.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onAddUser}>
          + Add New User
        </button>
      </div>

      {/* FILTER TOOLBAR */}
      <div className="filter-toolbar">
        <div className="filter-search-box">
          <input
            type="text"
            placeholder="Search by name, email, department..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="all">All Roles</option>
          {roles.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="saas-card">
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name & Email</th>
                <th>Account Type</th>
                <th>Role</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id}>
                  <td>
                    <div>
                      <strong style={{ display: 'block', color: 'var(--ci-text)' }}>{u.name}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>{u.email || u.id}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-category" style={{ textTransform: 'capitalize' }}>
                      {u.accountType || u.role}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-status-submitted">
                      {u.roleName || u.roleId || u.role}
                    </span>
                  </td>
                  <td>{u.departmentName || '—'}</td>
                  <td>{u.designationName || '—'}</td>
                  <td>
                    <span className={`badge ${u.status === 'active' ? 'badge-status-completed' : 'badge-priority-urgent'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEditUser(u)}
                      >
                        Edit
                      </button>
                      {u.id !== currentUser?.id && u.accountType !== 'super_admin' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ color: u.status === 'active' ? 'var(--ci-danger)' : 'var(--ci-success)' }}
                          onClick={() => onToggleStatus(u)}
                        >
                          {u.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
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
// ROLES & PERMISSIONS PANEL
// ==========================================================================
function RolesAndPermissionsPanel({ roles, isSuperAdmin, onEditRole, onAddRole, onReload, showNotification }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Roles & Permission Matrices</h2>
          <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', margin: '2px 0 0 0' }}>
            Configure functional privileges, data isolation scopes, and enterprise access levels.
          </p>
        </div>
        {isSuperAdmin && (
          <button type="button" className="btn btn-primary" onClick={onAddRole}>
            + Create New Role
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {roles.map(r => (
          <div key={r.id} className="saas-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ci-navy)', margin: 0 }}>
                    {r.name}
                  </h3>
                  <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)', textTransform: 'capitalize' }}>
                    Type: {r.accountType}
                  </span>
                </div>
                <span className="badge badge-category">
                  {r.permissions?.length || 0} permissions
                </span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--ci-text)', margin: '8px 0 16px 0', minHeight: '38px' }}>
                {r.description || 'Standard access policy configuration.'}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--ci-border-light)', paddingTop: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onEditRole(r)}
              >
                Configure Permissions ⚙️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================================================
// DEPARTMENTS & DESIGNATIONS PANEL
// ==========================================================================
function DepartmentsAndDesignationsPanel({ departments, designations, users, onAddDepartment, onEditDepartment, onAddDesignation, onEditDesignation }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="overview-grid">
        {/* DEPARTMENTS */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Departments ({departments.length})</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAddDepartment}>
              + Add Department
            </button>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td><code>{d.code}</code></td>
                    <td>
                      <span className={`badge ${d.status === 'active' ? 'badge-status-completed' : 'badge-priority-urgent'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditDepartment(d)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* DESIGNATIONS */}
        <div className="saas-card">
          <div className="card-header">
            <h3 className="card-title">Designations & Hierarchy ({designations.length})</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAddDesignation}>
              + Add Designation
            </button>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Designation</th>
                  <th>Level</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {designations.map(ds => (
                  <tr key={ds.id}>
                    <td style={{ fontWeight: 600 }}>{ds.name}</td>
                    <td>Level {ds.hierarchyLevel ?? 10}</td>
                    <td>
                      <span className={`badge ${ds.status === 'active' ? 'badge-status-completed' : 'badge-priority-urgent'}`}>
                        {ds.status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditDesignation(ds)}>
                        Edit
                      </button>
                    </td>
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
// AUDIT LOGS PANEL
// ==========================================================================
function AuditLogsPanel({ logs, onViewDetails }) {
  const [search, setSearch] = useState('');

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const mAction = (l.action || '').toLowerCase().includes(q);
        const mActor = (l.actorId || '').toLowerCase().includes(q);
        const mEntity = (l.entityType || '').toLowerCase().includes(q);
        if (!mAction && !mActor && !mEntity) return false;
      }
      return true;
    });
  }, [logs, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="filter-toolbar">
        <div className="filter-search-box">
          <input
            type="text"
            placeholder="Search audit trail by actor, action, entity..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="saas-card">
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity Target</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(l => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                    {new Date(l.createdAt).toLocaleString('en-US')}
                  </td>
                  <td style={{ fontWeight: 600 }}>{l.actorId}</td>
                  <td>
                    <span className="badge badge-category">{l.action}</span>
                  </td>
                  <td>
                    {l.entityType} #{l.entityId}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onViewDetails(l)}
                    >
                      View Details
                    </button>
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
function UserFormModal({ user, roles, departments, designations, allUsers, isSuperAdmin, onClose, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState(user?.accountType || 'employee');
  const [roleId, setRoleId] = useState(user?.roleId || roles[0]?.id || 'employee');
  const [departmentId, setDepartmentId] = useState(user?.departmentId || '');
  const [designationId, setDesignationId] = useState(user?.designationId || '');
  const [status, setStatus] = useState(user?.status || 'active');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      setErr('');
      const payload = {
        name,
        email,
        accountType,
        roleId,
        departmentId: departmentId ? Number(departmentId) : null,
        designationId: designationId ? Number(designationId) : null,
        status
      };
      if (password.trim()) {
        payload.password = password;
      }

      if (user) {
        await api.updateUser(user.id, payload);
      } else {
        if (!password) throw new Error('Password is required for new users');
        await api.createUser(payload);
      }
      onSaved();
    } catch (error) {
      setErr(error.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{user ? `Edit User: ${user.name}` : 'Create New User'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {err && <div className="alert-banner error" style={{ marginBottom: '12px' }}>{err}</div>}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Password {user ? '(leave blank to keep)' : ''}</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required={!user}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Account Type</label>
                <select
                  className="form-select"
                  value={accountType}
                  onChange={e => setAccountType(e.target.value)}
                >
                  <option value="employee">Internal Employee</option>
                  <option value="admin">Administrator</option>
                  <option value="client">Client</option>
                  {isSuperAdmin && <option value="super_admin">Super Administrator</option>}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Role Policy</label>
                <select
                  className="form-select"
                  value={roleId}
                  onChange={e => setRoleId(e.target.value)}
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Account Status</label>
                <select
                  className="form-select"
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Department</label>
                <select
                  className="form-select"
                  value={departmentId}
                  onChange={e => setDepartmentId(e.target.value)}
                >
                  <option value="">No Department Assigned</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Designation</label>
                <select
                  className="form-select"
                  value={designationId}
                  onChange={e => setDesignationId(e.target.value)}
                >
                  <option value="">No Designation Assigned</option>
                  {designations.map(ds => (
                    <option key={ds.id} value={ds.id}>{ds.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save User Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleFormModal({ role, onClose, onSaved }) {
  const [selectedPermissions, setSelectedPermissions] = useState(role?.permissions || []);
  const [saving, setSaving] = useState(false);

  const togglePermission = permId => {
    setSelectedPermissions(prev =>
      prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]
    );
  };

  const toggleGroup = groupPermissions => {
    const ids = groupPermissions.map(p => p.id);
    const allSelected = ids.every(id => selectedPermissions.includes(id));
    if (allSelected) {
      setSelectedPermissions(prev => prev.filter(p => !ids.includes(p)));
    } else {
      setSelectedPermissions(prev => Array.from(new Set([...prev, ...ids])));
    }
  };

  const handleSave = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      await api.updateRolePermissions(role.id, selectedPermissions);
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to update permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '820px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Configure Role: {role.name}</h3>
            <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>
              {selectedPermissions.length} permissions assigned
            </span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {permissionGroups.map(grp => {
                const groupIds = grp.permissions.map(p => p.id);
                const allSelected = groupIds.every(id => selectedPermissions.includes(id));
                const someSelected = groupIds.some(id => selectedPermissions.includes(id));

                return (
                  <div key={grp.category} style={{ border: '1px solid var(--ci-border)', borderRadius: '10px', padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <strong style={{ fontSize: '14px', color: 'var(--ci-navy)' }}>{grp.category}</strong>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11.5px', padding: '2px 8px' }}
                        onClick={() => toggleGroup(grp.permissions)}
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      {grp.permissions.map(perm => {
                        const isChecked = selectedPermissions.includes(perm.id);
                        return (
                          <label
                            key={perm.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '12.5px',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: '6px',
                              background: isChecked ? 'var(--ci-surface)' : 'transparent'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(perm.id)}
                            />
                            <span>{perm.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Permissions Matrix'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DepartmentFormModal({ department, onClose, onSaved }) {
  const [name, setName] = useState(department?.name || '');
  const [code, setCode] = useState(department?.code || '');
  const [description, setDescription] = useState(department?.description || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      if (department) {
        await api.updateDepartment(department.id, { name, code, description });
      } else {
        await api.createDepartment({ name, code, description });
      }
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{department ? 'Edit Department' : 'Add Department'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Department Name</label>
              <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Department Code (e.g. ENG, MKT)</label>
              <input type="text" className="form-control" value={code} onChange={e => setCode(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Department'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DesignationFormModal({ designation, onClose, onSaved }) {
  const [name, setName] = useState(designation?.name || '');
  const [code, setCode] = useState(designation?.code || '');
  const [hierarchyLevel, setHierarchyLevel] = useState(designation?.hierarchyLevel ?? 10);
  const [description, setDescription] = useState(designation?.description || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      if (designation) {
        await api.updateDesignation(designation.id, { name, code, hierarchyLevel: Number(hierarchyLevel), description });
      } else {
        await api.createDesignation({ name, code, hierarchyLevel: Number(hierarchyLevel), description });
      }
      onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save designation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{designation ? 'Edit Designation' : 'Add Designation'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Designation Name</label>
              <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Hierarchy Level (1 = Highest Executive, 10 = Junior)</label>
              <input type="number" min="1" max="99" className="form-control" value={hierarchyLevel} onChange={e => setHierarchyLevel(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Designation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AuditDetailModal({ log, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Audit Record #{log.id}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', display: 'block' }}>Timestamp</span>
              <strong>{new Date(log.createdAt).toLocaleString()}</strong>
            </div>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', display: 'block' }}>Actor ID</span>
              <strong>{log.actorId}</strong>
            </div>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', display: 'block' }}>Action</span>
              <span className="badge badge-category">{log.action}</span>
            </div>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', display: 'block' }}>Entity</span>
              <strong>{log.entityType} #{log.entityId}</strong>
            </div>
          </div>

          <span style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Payload Details:</span>
          <pre style={{ background: 'var(--ci-surface)', border: '1px solid var(--ci-border)', padding: '12px', borderRadius: '8px', fontSize: '12px', overflowX: 'auto' }}>
            {JSON.stringify(log.details, null, 2)}
          </pre>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
