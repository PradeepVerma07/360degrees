import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, getToken, setToken } from './api';
import { addWorkingHours } from './tat';
import SupportTickets from './SupportTickets';
import TeamChat from './TeamChat';
import ProductivityIntelligence from './ProductivityIntelligence';
import ManageUsersAndRoles from './ManageUsersAndRoles';
import './styles.css';

const statusLabels = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  in_progress: 'In Progress',
  waiting_client: 'Waiting for Client',
  revision_requested: 'Revision Requested',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

const statusBadgeClasses = {
  submitted: 'badge-status-submitted',
  under_review: 'badge-status-under-review',
  in_progress: 'badge-status-in-progress',
  waiting_client: 'badge-status-waiting-client',
  revision_requested: 'badge-status-revision-requested',
  on_hold: 'badge-status-on-hold',
  completed: 'badge-status-completed',
  cancelled: 'badge-status-cancelled'
};

const priorityBadgeClasses = {
  Urgent: 'badge-priority-urgent',
  High: 'badge-priority-high',
  Medium: 'badge-priority-medium',
  Low: 'badge-priority-low'
};

const priorityRank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const openStatuses = new Set(['submitted', 'under_review', 'in_progress', 'waiting_client', 'revision_requested', 'on_hold']);
const isPendingJob = job => openStatuses.has(job.status);
const isCompletedJob = job => job.status === 'completed';

const formatDisplayDate = value => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDisplayDateTime = value => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

function formatHourDecimal(dec) {
  if (dec === undefined || dec === null) return '10:30 AM';
  const hours = Math.floor(dec);
  const minutes = Math.round((dec % 1) * 60);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes ? `:${String(minutes).padStart(2, '0')}` : ':00';
  return `${displayHours}${displayMinutes} ${period}`;
}

function formatWorkDays(days) {
  if (!Array.isArray(days) || !days.length) return 'Mon – Fri';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (days.length === 5 && days[0] === 1 && days[4] === 5) return 'Mon – Fri';
  return days.map(d => dayNames[d]).join(', ');
}

const initialsFor = value =>
  (value || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() || 'U';

const can = (data, permission) => (data?.permissions || data?.user?.permissions || []).includes(permission);
const canAny = (data, permissions) => permissions.some(permission => can(data, permission));

// Category Icons Mapping
function CategoryIcon({ category }) {
  const c = (category || '').toLowerCase();
  if (c.includes('web') || c.includes('site')) {
    return <DashboardIcon name="globe" />;
  }
  if (c.includes('social') || c.includes('media') && !c.includes('upload')) {
    return <DashboardIcon name="share" />;
  }
  if (c.includes('upload') || c.includes('file')) {
    return <DashboardIcon name="cloud" />;
  }
  if (c.includes('graphic') || c.includes('design')) {
    return <DashboardIcon name="pen" />;
  }
  if (c.includes('copy') || c.includes('content') || c.includes('write')) {
    return <DashboardIcon name="document" />;
  }
  if (c.includes('video') || c.includes('film') || c.includes('edit')) {
    return <DashboardIcon name="video" />;
  }
  if (c.includes('seo') || c.includes('search')) {
    return <DashboardIcon name="search" />;
  }
  return <DashboardIcon name="more" />;
}

// Master Dashboard Line Icons
function DashboardIcon({ name }) {
  switch (name) {
    case 'overview':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'submit':
    case 'plus-circle':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
    case 'jobs':
    case 'briefcase':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case 'clock':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'users':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'support':
    case 'lifebuoy':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
          <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
          <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
          <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
        </svg>
      );
    case 'chat':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'productivity':
    case 'trending-up':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case 'shield':
    case 'roles':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'bell':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case 'logout':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case 'bar-chart':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case 'check-circle':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'alert-triangle':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'zap':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'globe':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'share':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      );
    case 'cloud':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
      );
    case 'pen':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case 'document':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case 'video':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    case 'search':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'more':
      return (
        <svg className="workload-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case 'menu':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    default:
      return null;
  }
}

// Main App Component
export default function App() {
  const [auth, setAuth] = useState(Boolean(getToken()));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [socketConnected, setSocketConnected] = useState(false);
  const [supportCreateSignal, setSupportCreateSignal] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.bootstrap();
      setData(res);
      setError('');
    } catch (e) {
      if (e.message.includes('Session') || e.message.includes('token') || e.message.includes('Authentication')) {
        setToken(null);
        setAuth(false);
      } else {
        setError(e.message);
      }
    }
  }, []);

  useEffect(() => {
    if (!auth) return;
    load();
    const socket = io(API_URL || undefined);
    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('data:changed', load);
    socket.on('permissions:updated', load);
    socket.on('productivity:changed', load);
    return () => {
      socket.disconnect();
    };
  }, [auth, load]);

  if (!auth) {
    return <LoginPage onLogin={() => setAuth(true)} />;
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--ci-bg)' }}>
        <p style={{ color: 'var(--ci-text-secondary)', fontWeight: 500 }}>{error || 'Loading workspace...'}</p>
      </div>
    );
  }

  const logout = () => {
    setToken(null);
    setAuth(false);
    setData(null);
  };

  const openSupportModal = () => {
    setSupportCreateSignal(c => c + 1);
    setTab('support');
  };

  return (
    <DashboardShell
      data={data}
      tab={tab}
      setTab={setTab}
      logout={logout}
      socketConnected={socketConnected}
      openSupportModal={openSupportModal}
    >
      {tab === 'overview' && <OverviewPage data={data} setTab={setTab} openSupportModal={openSupportModal} />}
      {tab === 'submit' && <SubmitJobPage data={data} reload={load} setTab={setTab} />}
      {tab === 'jobs' && <JobsListPage data={data} reload={load} />}
      {tab === 'productivity' && <ProductivityIntelligence data={data} reload={load} />}
      {tab === 'chat' && <TeamChat data={data} reload={load} />}
      {tab === 'settings' && <TatStandardsPage data={data} reload={load} />}
      {tab === 'clients' && <ManageClientsPage data={data} reload={load} />}
      {tab === 'users' && <ManageUsersAndRoles data={data} reload={load} />}
      {tab === 'support' && <SupportTickets data={data} reload={load} openCreateSignal={supportCreateSignal} />}
    </DashboardShell>
  );
}

// ==========================================================================
// 1. DASHBOARD SHELL (SIDEBAR + TOP HEADER)
// ==========================================================================

function DashboardShell({ data, tab, setTab, logout, socketConnected, openSupportModal, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const notifRef = useRef(null);
  const userMenuRef = useRef(null);

  const user = data.user || {};
  const isSuperOrAdmin = user.role === 'admin' || user.accountType === 'admin' || user.accountType === 'super_admin';
  const hasProductivityAccess = can(data, 'productivity.view');
  const hasUsersAccess = can(data, 'users.view') || can(data, 'roles.view') || can(data, 'departments.manage') || isSuperOrAdmin;
  const hasChatAccess = can(data, 'chat.view') || can(data, 'chat.send');
  const hasSettingsAccess = can(data, 'settings.view') || can(data, 'settings.edit') || isSuperOrAdmin;
  const hasClientsAccess = can(data, 'clients.view') || can(data, 'clients.view_all') || isSuperOrAdmin;
  const hasSupportAccess = can(data, 'support.view_all') || can(data, 'support.view_own') || can(data, 'support.create');

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotificationOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Dynamic navigation items based on assigned user permissions
  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'submit', label: 'Submit a Job', icon: 'submit' },
    { id: 'jobs', label: isSuperOrAdmin ? 'All Jobs' : 'My Jobs', icon: 'jobs' },
    ...(hasProductivityAccess ? [{ id: 'productivity', label: 'Productivity Intelligence', icon: 'productivity' }] : []),
    ...(hasChatAccess ? [{ id: 'chat', label: 'Team Chat', icon: 'chat' }] : []),
    ...(hasSettingsAccess ? [{ id: 'settings', label: 'TAT Standards', icon: 'clock' }] : []),
    ...(hasClientsAccess ? [{ id: 'clients', label: 'Manage Clients', icon: 'users' }] : []),
    ...(hasUsersAccess ? [{ id: 'users', label: 'Users & Roles', icon: 'shield' }] : []),
    ...(hasSupportAccess ? [{ id: 'support', label: 'Support Tickets', icon: 'support' }] : [])
  ];

  const pageHeaders = {
    overview: {
      title: 'Overview',
      subtitle: 'Realtime visibility across jobs, workload and delivery timelines.'
    },
    submit: {
      title: 'Submit a Job',
      subtitle: 'Create a new job request and calculate turnaround time.'
    },
    jobs: {
      title: isSuperOrAdmin ? 'All Jobs' : 'My Jobs',
      subtitle: 'Track, manage and filter all operational work requests.'
    },
    productivity: {
      title: 'Productivity Intelligence',
      subtitle: 'Workforce capacity, revenue attribution, throughput targets, and account roster analytics.'
    },
    chat: {
      title: 'Team Chat',
      subtitle: 'Real-time team communication, channels and collaboration.'
    },
    settings: {
      title: 'TAT Standards',
      subtitle: 'Configure category turnaround times, capacities and working hours.'
    },
    clients: {
      title: 'Manage Clients',
      subtitle: 'Each client logs in with their own ID and password and only sees their own jobs.'
    },
    users: {
      title: 'Users & Access Control',
      subtitle: 'Manage user accounts, RBAC permission policies, departments and organizational hierarchy.'
    },
    support: {
      title: isSuperOrAdmin ? 'Support Tickets' : 'My Support Tickets',
      subtitle: isSuperOrAdmin ? 'Review, reply to and manage submitted tickets.' : 'Raise a ticket and track your support conversations.'
    }
  };

  const currentHeader = pageHeaders[tab] || { title: 'Workspace', subtitle: '' };

  const handleNavClick = id => {
    setTab(id);
    setMobileOpen(false);
    setNotificationOpen(false);
    setUserMenuOpen(false);
  };

  // Real open support tickets count for notification badge
  const openTickets = (data.supportTickets || []).filter(t => !['Resolved', 'Closed'].includes(t.status));
  const openTicketCount = openTickets.length;
  const recentJobs = (data.jobs || []).slice(0, 3);

  return (
    <div className={`app-shell ${mobileOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />

      {/* LEFT SIDEBAR */}
      <aside className="app-sidebar">
        {/* BRAND & CONTROLS */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="brand-logo-text">
              <span className="brand-navy">CI360</span>
              <span className="brand-gold">degrees</span>
            </span>
            <span className="brand-subtitle">Realtime Job Board</span>
          </div>
          {/* Desktop Collapse Button */}
          <button
            type="button"
            className="sidebar-collapse-btn desktop-only"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            onClick={() => setSidebarCollapsed(v => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          {/* Mobile Drawer Close Button */}
          <button
            type="button"
            className="sidebar-close-btn mobile-only"
            aria-label="Close sidebar menu"
            onClick={() => setMobileOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* MAIN CTA */}
        <button
          type="button"
          className="sidebar-cta-btn"
          title="Submit a Job"
          onClick={() => handleNavClick('submit')}
        >
          <DashboardIcon name="submit" />
          <span>+ Submit a Job</span>
        </button>

        {/* NAVIGATION ITEMS */}
        <nav className="sidebar-nav">
          {navItems.map(item => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                title={item.label}
                onClick={() => handleNavClick(item.id)}
              >
                <DashboardIcon name={item.icon} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* CRITICAL: INTENTIONAL BLANK WHITESPACE RESERVED FOR FUTURE MODULES */}
        <div className="sidebar-spacer" />

        {/* SIDEBAR FOOTER (USER & LOGOUT) */}
        <div className="sidebar-footer">
          <div className="sidebar-user-card" onClick={() => setUserMenuOpen(v => !v)} title="User Profile">
            <div className="user-avatar-circle">
              {initialsFor(user.name)}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user.name || 'Workspace User'}</span>
              <span className="sidebar-user-role">
                {isSuperOrAdmin ? 'Administrator' : 'Client'}
              </span>
            </div>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#98A2B3" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          <button type="button" className="sidebar-logout-btn" title="Logout" onClick={logout}>
            <DashboardIcon name="logout" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="app-main">
        {/* TOP HEADER */}
        <header className="top-header">
          <div className="header-left">
            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <DashboardIcon name="menu" />
            </button>
            <div className="header-title-block">
              <h1 className="header-page-title">{currentHeader.title}</h1>
            </div>
          </div>

          <div className="header-right">
            {/* Realtime Status Pill */}
            <div className={`realtime-status-pill ${socketConnected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot" />
              <span>{socketConnected ? 'Realtime Connected' : 'Connecting...'}</span>
            </div>

            {/* Notification Bell with Interactive Dropdown */}
            <div className="header-dropdown-container" ref={notifRef}>
              <button
                type="button"
                className="notification-bell-btn"
                title="Notifications"
                onClick={() => {
                  setNotificationOpen(v => !v);
                  setUserMenuOpen(false);
                }}
              >
                <DashboardIcon name="bell" />
                {openTicketCount > 0 && (
                  <span className="notification-badge-count">{openTicketCount}</span>
                )}
              </button>

              {notificationOpen && (
                <div className="header-dropdown-menu notification-menu">
                  <div className="dropdown-menu-header">
                    <div>
                      <strong>Notifications</strong>
                      <span className="badge badge-category" style={{ marginLeft: '6px' }}>
                        {openTicketCount} Open
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-link-subtle"
                      onClick={() => setNotificationOpen(false)}
                    >
                      Close
                    </button>
                  </div>

                  <div className="dropdown-menu-list">
                    {openTickets.length === 0 && recentJobs.length === 0 ? (
                      <div className="dropdown-empty-state">
                        <span>🔔</span>
                        <p>No new notifications</p>
                      </div>
                    ) : (
                      <>
                        {openTickets.map(t => (
                          <div
                            key={t.ticketNumber}
                            className="dropdown-notification-item"
                            onClick={() => handleNavClick('support')}
                          >
                            <div className="notif-icon-circle ticket">🎫</div>
                            <div className="notif-item-body">
                              <div className="notif-item-title">
                                <strong>Ticket #{t.ticketNumber}</strong>
                                <span className={`badge ${t.priority === 'Urgent' ? 'badge-priority-urgent' : 'badge-priority-medium'}`}>
                                  {t.priority}
                                </span>
                              </div>
                              <p className="notif-item-desc">{t.subject}</p>
                              <span className="notif-item-meta">{t.userName} • {t.status}</span>
                            </div>
                          </div>
                        ))}

                        {recentJobs.map(j => (
                          <div
                            key={j.jobId}
                            className="dropdown-notification-item"
                            onClick={() => handleNavClick('jobs')}
                          >
                            <div className="notif-icon-circle job">💼</div>
                            <div className="notif-item-body">
                              <div className="notif-item-title">
                                <strong>Job #{j.jobId}</strong>
                                <span className="badge badge-status-in-progress">{j.status}</span>
                              </div>
                              <p className="notif-item-desc">{j.title || j.category}</p>
                              <span className="notif-item-meta">Client: {j.clientId}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  <div className="dropdown-menu-footer">
                    <button
                      type="button"
                      className="btn-link-action"
                      onClick={() => handleNavClick('support')}
                    >
                      View all support tickets →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Avatar with Interactive Dropdown */}
            <div className="header-dropdown-container" ref={userMenuRef}>
              <div
                className="header-user-avatar"
                title={`${user.name} (${user.accountType || user.role})`}
                onClick={() => {
                  setUserMenuOpen(v => !v);
                  setNotificationOpen(false);
                }}
              >
                {initialsFor(user.name)}
              </div>

              {userMenuOpen && (
                <div className="header-dropdown-menu user-profile-menu">
                  {/* User Profile Info Header */}
                  <div className="dropdown-user-header">
                    <div className="user-avatar-circle large">
                      {initialsFor(user.name)}
                    </div>
                    <div className="dropdown-user-details">
                      <strong className="dropdown-user-fullname">{user.name || 'Workspace User'}</strong>
                      <span className="dropdown-user-email">{user.email || user.id}</span>
                      <div style={{ marginTop: '4px' }}>
                        <span className="badge badge-category" style={{ textTransform: 'capitalize' }}>
                          {user.accountType || user.role || 'Member'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="dropdown-divider" />

                  {/* Navigation Shortcuts */}
                  <div className="dropdown-menu-items">
                    <button
                      type="button"
                      className="dropdown-menu-btn"
                      onClick={() => handleNavClick('overview')}
                    >
                      <DashboardIcon name="overview" />
                      <span>Overview Dashboard</span>
                    </button>

                    {hasProductivityAccess && (
                      <button
                        type="button"
                        className="dropdown-menu-btn"
                        onClick={() => handleNavClick('productivity')}
                      >
                        <DashboardIcon name="productivity" />
                        <span>Productivity Intelligence</span>
                      </button>
                    )}

                    {hasUsersAccess && (
                      <button
                        type="button"
                        className="dropdown-menu-btn"
                        onClick={() => handleNavClick('users')}
                      >
                        <DashboardIcon name="shield" />
                        <span>Users & Access Control</span>
                      </button>
                    )}

                    {hasSettingsAccess && (
                      <button
                        type="button"
                        className="dropdown-menu-btn"
                        onClick={() => handleNavClick('settings')}
                      >
                        <DashboardIcon name="clock" />
                        <span>TAT Standards & Settings</span>
                      </button>
                    )}

                    {hasSupportAccess && (
                      <button
                        type="button"
                        className="dropdown-menu-btn"
                        onClick={() => handleNavClick('support')}
                      >
                        <DashboardIcon name="support" />
                        <span>Support Tickets</span>
                      </button>
                    )}
                  </div>

                  <div className="dropdown-divider" />

                  <div style={{ padding: '6px' }}>
                    <button
                      type="button"
                      className="dropdown-logout-btn"
                      onClick={logout}
                    >
                      <DashboardIcon name="logout" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* PAGE CONTENT */}
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}

// ==========================================================================
// 2. OVERVIEW DASHBOARD COMPONENT (EXACT MATCH TO DESIGN SPEC)
// ==========================================================================

function OverviewPage({ data, setTab, openSupportModal }) {
  const jobs = data.jobs || [];
  const settings = data.settings || { categories: [], capacityPerCategory: 2, bufferHoursPerExtraJob: 8, startHour: 10.5, endHour: 19, workDays: [1, 2, 3, 4, 5] };
  const categories = settings.categories || [];
  const activeJobs = useMemo(() => jobs.filter(isPendingJob), [jobs]);
  const completedJobs = useMemo(() => jobs.filter(isCompletedJob), [jobs]);
  const urgentJobs = useMemo(() => activeJobs.filter(j => j.priority === 'Urgent'), [activeJobs]);

  const isSuperOrAdmin = data.user?.role === 'admin' || data.user?.accountType === 'admin' || data.user?.accountType === 'super_admin';
  const activeClientsCount = (data.clients || []).filter(c => c.status === 'active').length;

  // Active jobs by category count
  const activeByCategory = useMemo(() => {
    const counts = {};
    for (const j of activeJobs) {
      counts[j.category] = (counts[j.category] || 0) + 1;
    }
    return counts;
  }, [activeJobs]);

  // Support Tickets Status Counts
  const tickets = data.supportTickets || [];
  const ticketCounts = useMemo(() => {
    const map = { Open: 0, 'In Progress': 0, 'Waiting for User': 0, Resolved: 0, Closed: 0 };
    for (const t of tickets) {
      if (map[t.status] !== undefined) {
        map[t.status] += 1;
      }
    }
    return map;
  }, [tickets]);

  // Recently updated 4-6 jobs
  const recentJobs = useMemo(() => {
    return [...jobs]
      .sort((a, b) => new Date(b.updatedAt || b.datePosted).getTime() - new Date(a.updatedAt || a.datePosted).getTime())
      .slice(0, 5);
  }, [jobs]);

  const stripeColors = ['#E63946', '#1D4ED8', '#10B981', '#F59E0B', '#8B5CF6'];

  return (
    <div className="overview-grid">
      {/* LEFT / CENTER MAJOR COLUMN */}
      <div className="overview-left-col">
        {/* CARD 1: CURRENT WORKLOAD */}
        <section className="saas-card">
          <div className="card-header">
            <div className="card-title-group">
              <DashboardIcon name="bar-chart" />
              <h2 className="card-title">Current Workload</h2>
            </div>
          </div>

          <div className="workload-table-wrap">
            <table className="workload-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Active Jobs</th>
                  <th>Capacity</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => {
                  const activeCount = activeByCategory[cat.name] || 0;
                  const capacity = cat.baseCapacity || settings.capacityPerCategory || 2;
                  const utilPct = capacity > 0 ? Math.round((activeCount / capacity) * 100) : 0;

                  let tone = 'gray';
                  if (utilPct > 100) tone = 'red';
                  else if (utilPct > 50) tone = 'amber';
                  else if (utilPct > 0) tone = 'green';

                  return (
                    <tr key={cat.name}>
                      <td>
                        <div className="workload-cat-cell">
                          <CategoryIcon category={cat.name} />
                          <span>{cat.name}</span>
                        </div>
                      </td>
                      <td className="workload-count-num">{activeCount}</td>
                      <td>{capacity}</td>
                      <td>
                        <div className="workload-util-cell">
                          <span className={`workload-util-pct ${tone}`}>{utilPct}%</span>
                          <div className="workload-progress-track">
                            <div
                              className={`workload-progress-fill ${tone}`}
                              style={{ width: `${Math.min(utilPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* CARD 2: RECENTLY UPDATED JOBS */}
        <section className="saas-card">
          <div className="card-header">
            <div className="card-title-group">
              <h2 className="card-title">Recently Updated Jobs</h2>
            </div>
          </div>

          <div className="recent-jobs-list">
            {recentJobs.length === 0 ? (
              <div className="empty-state-box">
                <p className="empty-state-title">No jobs found</p>
                <p className="empty-state-text">New active jobs will appear here once submitted.</p>
              </div>
            ) : (
              recentJobs.map((job, idx) => {
                const stripe = stripeColors[idx % stripeColors.length];
                const dueDate = addWorkingHours(
                  new Date(job.datePosted),
                  job.teamOverrideHours ?? job.calculatedHours,
                  settings
                );

                return (
                  <div
                    key={job.id}
                    className="recent-job-item"
                    style={{ '--job-stripe': stripe }}
                  >
                    <div className="recent-job-main">
                      <span className="recent-job-title">{job.title}</span>
                      <span className="recent-job-posted">
                        Posted by {job.postedBy || 'Member'} · {formatDisplayDateTime(job.datePosted)}
                      </span>
                    </div>

                    <div className="recent-job-badges-wrap">
                      <span className="badge badge-category">{job.category}</span>
                      <span className={`badge ${priorityBadgeClasses[job.priority] || 'badge-priority-medium'}`}>
                        {job.priority}
                      </span>
                      <span className={`badge ${statusBadgeClasses[job.status] || 'badge-status-submitted'}`}>
                        {statusLabels[job.status] || job.status}
                      </span>
                      <span className="recent-job-due">
                        Due: {formatDisplayDate(dueDate)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <button
            type="button"
            className="card-view-all-btn"
            onClick={() => setTab('jobs')}
          >
            <span>View All Jobs</span>
            <DashboardIcon name="chevron-right" />
          </button>
        </section>
      </div>

      {/* RIGHT RAIL INFORMATION COLUMN */}
      <div className="overview-right-col">
        {/* PANEL 1: JOB OVERVIEW 2x2 METRICS */}
        <section className="saas-card">
          <div className="card-header">
            <h2 className="card-title">Job Overview</h2>
            <span className="card-badge-pill">
              Current
              <DashboardIcon name="chevron-down" />
            </span>
          </div>

          <div className="metrics-2x2-grid">
            {/* Metric 1: Active Jobs */}
            <div className="metric-box">
              <div className="metric-box-top">
                <div className="metric-icon-wrap green">
                  <DashboardIcon name="jobs" />
                </div>
              </div>
              <span className="metric-title">Active Jobs</span>
              <span className="metric-number">{activeJobs.length}</span>
              <span className="metric-subtext">Across all categories</span>
            </div>

            {/* Metric 2: Completed */}
            <div className="metric-box">
              <div className="metric-box-top">
                <div className="metric-icon-wrap green">
                  <DashboardIcon name="check-circle" />
                </div>
              </div>
              <span className="metric-title">Completed</span>
              <span className="metric-number">{completedJobs.length}</span>
              <span className="metric-subtext">This period</span>
            </div>

            {/* Metric 3: Urgent */}
            <div className="metric-box">
              <div className="metric-box-top">
                <div className="metric-icon-wrap red">
                  <DashboardIcon name="alert-triangle" />
                </div>
              </div>
              <span className="metric-title">Urgent</span>
              <span className="metric-number">{urgentJobs.length}</span>
              <span className="metric-subtext">Requires immediate attention</span>
            </div>

            {/* Metric 4: Clients or My Jobs */}
            <div className="metric-box">
              <div className="metric-box-top">
                <div className="metric-icon-wrap blue">
                  <DashboardIcon name="users" />
                </div>
              </div>
              <span className="metric-title">{isSuperOrAdmin ? 'Clients' : 'My Jobs'}</span>
              <span className="metric-number">{isSuperOrAdmin ? activeClientsCount : jobs.length}</span>
              <span className="metric-subtext">{isSuperOrAdmin ? 'Active clients' : 'Your organisation jobs'}</span>
            </div>
          </div>
        </section>

        {/* PANEL 2: WORKLOAD OVERVIEW */}
        <section className="saas-card">
          <div className="card-header">
            <h2 className="card-title">Workload Overview</h2>
            <span className="card-badge-pill">
              Current
              <DashboardIcon name="chevron-down" />
            </span>
          </div>

          <div className="workload-overview-legend">
            <div className="legend-item">
              <span className="legend-square navy" />
              <span>Active Jobs</span>
            </div>
            <div className="legend-item">
              <span className="legend-square gray" />
              <span>Capacity</span>
            </div>
          </div>

          <div className="workload-bar-list">
            {categories.map(cat => {
              const activeCount = activeByCategory[cat.name] || 0;
              const capacity = cat.baseCapacity || settings.capacityPerCategory || 2;
              const maxScale = Math.max(capacity * 1.5, activeCount, 1);
              const activeWidth = (activeCount / maxScale) * 100;

              let ratioTone = 'gray';
              if (activeCount > capacity) ratioTone = 'red';
              else if (activeCount === capacity && activeCount > 0) ratioTone = 'amber';
              else if (activeCount > 0) ratioTone = 'green';

              return (
                <div key={cat.name} className="workload-bar-row">
                  <span className="workload-bar-label">{cat.name}</span>
                  <div className="workload-bar-track-wrap">
                    <div
                      className="workload-bar-active-fill"
                      style={{ width: `${activeWidth}%` }}
                    />
                  </div>
                  <span className={`workload-bar-ratio ${ratioTone}`}>
                    {activeCount} / {capacity}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* PANEL 3: SUMMARY SPLIT CARDS */}
        <div className="summary-split-grid">
          {/* Support Tickets Summary */}
          <div className="summary-compact-card">
            <div>
              <div className="summary-card-head">
                <DashboardIcon name="support" />
                <span>Support Tickets</span>
              </div>
              <div className="summary-kv-list">
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Open</span>
                  <span className="summary-kv-val" style={{ color: '#175CD3' }}>{ticketCounts['Open']}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">In Progress</span>
                  <span className="summary-kv-val" style={{ color: '#F79009' }}>{ticketCounts['In Progress']}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Waiting for User</span>
                  <span className="summary-kv-val" style={{ color: '#027A48' }}>{ticketCounts['Waiting for User']}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Resolved</span>
                  <span className="summary-kv-val">{ticketCounts['Resolved']}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Closed</span>
                  <span className="summary-kv-val">{ticketCounts['Closed']}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="summary-footer-btn"
              onClick={() => setTab('support')}
            >
              <span>View all tickets</span>
              <DashboardIcon name="chevron-right" />
            </button>
          </div>

          {/* TAT Standards Summary */}
          <div className="summary-compact-card">
            <div>
              <div className="summary-card-head">
                <DashboardIcon name="clock" />
                <span>TAT Standards</span>
              </div>
              <div className="summary-kv-list">
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Category Capacity</span>
                  <span className="summary-kv-val">{settings.capacityPerCategory}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Extra Hours Over Capacity</span>
                  <span className="summary-kv-val">{settings.bufferHoursPerExtraJob}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Working Hours</span>
                  <span className="summary-kv-val">
                    {formatHourDecimal(settings.startHour)} – {formatHourDecimal(settings.endHour)}
                  </span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Work Days</span>
                  <span className="summary-kv-val">{formatWorkDays(settings.workDays)}</span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-key">Total Categories</span>
                  <span className="summary-kv-val">{categories.length}</span>
                </div>
              </div>
            </div>
            {isSuperOrAdmin && (
              <button
                type="button"
                className="summary-footer-btn"
                onClick={() => setTab('settings')}
              >
                <span>Manage Standards</span>
                <DashboardIcon name="chevron-right" />
              </button>
            )}
          </div>
        </div>

        {/* PANEL 4: QUICK ACTIONS */}
        <section className="saas-card">
          <div className="card-header" style={{ marginBottom: '14px' }}>
            <div className="card-title-group" style={{ color: 'var(--ci-gold)' }}>
              <DashboardIcon name="zap" />
              <h2 className="card-title" style={{ color: 'var(--ci-text)' }}>Quick Actions</h2>
            </div>
          </div>

          <div className="quick-actions-list">
            <button
              type="button"
              className="quick-action-pill-btn"
              onClick={() => setTab('submit')}
            >
              <DashboardIcon name="submit" />
              <span>+ Submit a Job</span>
            </button>

            <button
              type="button"
              className="quick-action-pill-btn"
              onClick={() => setTab('jobs')}
            >
              <DashboardIcon name="jobs" />
              <span>View All Jobs</span>
            </button>

            <button
              type="button"
              className="quick-action-pill-btn"
              onClick={openSupportModal}
            >
              <DashboardIcon name="support" />
              <span>Raise Ticket</span>
            </button>

            {isSuperOrAdmin && (
              <>
                <button
                  type="button"
                  className="quick-action-pill-btn"
                  onClick={() => setTab('clients')}
                >
                  <DashboardIcon name="users" />
                  <span>Manage Clients</span>
                </button>

                <button
                  type="button"
                  className="quick-action-pill-btn"
                  onClick={() => setTab('settings')}
                >
                  <DashboardIcon name="clock" />
                  <span>TAT Standards</span>
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ==========================================================================
// 3. SUBMIT A JOB PAGE
// ==========================================================================

function SubmitJobPage({ data, reload, setTab }) {
  const categories = data.settings?.categories || [];
  const firstCat = categories[0]?.name || 'Website Changes';
  const defaultClient = data.clients?.find(c => c.status === 'active')?.id || '';
  const isSuperOrAdmin = data.user?.role === 'admin' || data.user?.accountType === 'admin' || data.user?.accountType === 'super_admin';
  const employees = (data?.clientOwners || []).filter(u => u.accountType !== 'client' && u.role !== 'client');
  const leadUser = employees.find(u => u.name === 'Urna') || employees.find(u => u.name === 'Mansi') || employees[0];

  const [servicesList, setServicesList] = useState([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);

  useEffect(() => {
    api.productivityServices().then(res => setServicesList(res || [])).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    clientId: defaultClient,
    title: '',
    description: '',
    category: firstCat,
    priority: 'Medium',
    postedBy: data.user?.name || '',
    assetLink: '',
    startDate: new Date().toISOString().substring(0, 10),
    completionDate: '',
    valueAmount: '',
    assignedToUserId: leadUser?.id || ''
  });

  const [assignments, setAssignments] = useState([
    { userId: leadUser?.id || employees[0]?.id || data.user?.id || '', revenuePercent: 100, hoursSpent: '' }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totalRevPercent = assignments.reduce((sum, a) => sum + Number(a.revenuePercent || 0), 0);

  const addAssignee = () => {
    setAssignments(prev => [
      ...prev,
      { userId: employees[0]?.id || '', revenuePercent: 0, hoursSpent: '' }
    ]);
  };

  const updateAssignment = (idx, field, val) => {
    setAssignments(prev =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: val } : a))
    );
  };

  const removeAssignment = idx => {
    setAssignments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Please enter a job title');
    if (isSuperOrAdmin && assignments.length > 0 && totalRevPercent !== 100) {
      return setError(`Revenue allocation total must equal 100% (currently ${totalRevPercent}%)`);
    }

    try {
      setSubmitting(true);
      setError('');
      // 1. Create standard Job
      await api.createJob(form);

      // 2. Also log in Productivity Intelligence if user is internal
      if (isSuperOrAdmin) {
        try {
          await api.createProductivityJob({
            clientId: form.clientId,
            startDate: form.startDate,
            completionDate: form.completionDate || null,
            valueAmount: Number(form.valueAmount || 0),
            description: form.title + (form.description ? ' — ' + form.description : ''),
            serviceIds: selectedServiceIds,
            assignments: assignments.filter(a => a.userId).map(a => ({
              userId: a.userId,
              revenuePercent: Number(a.revenuePercent || 0),
              hoursSpent: Number(a.hoursSpent || 0)
            }))
          });
        } catch (_) {
          // Non-blocking if productivity already tracked
        }
      }

      setSuccess('Job submitted and assigned successfully!');
      await reload();
      setTimeout(() => {
        setTab('jobs');
      }, 900);
    } catch (err) {
      setError(err.message || 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto' }}>
      <div className="saas-card">
        <div className="card-header">
          <div>
            <h2 className="card-title" style={{ fontSize: '18px' }}>Submit a Job</h2>
            <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>
              Complete the deliverables, timing, services, and team allocations
            </span>
          </div>
        </div>

        {error && <div className="alert-banner error" style={{ marginBottom: '16px' }}>{error}</div>}
        {success && <div className="alert-banner success" style={{ marginBottom: '16px' }}>{success}</div>}

        <form onSubmit={handleSubmit}>
          {/* Client & Title */}
          <div className="form-row">
            {isSuperOrAdmin ? (
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Client / Account</label>
                <select
                  className="form-select"
                  value={form.clientId}
                  onChange={e => setForm({ ...form, clientId: e.target.value })}
                  required
                >
                  {data.clients?.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="form-group" style={{ flex: 1.5 }}>
              <label className="form-label">Job Title / Deliverable</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Website revamp & Q3 Social Media package"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Dates & Job Value */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-control"
                value={form.startDate}
                onChange={e => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Completion Date (optional)</label>
              <input
                type="date"
                className="form-control"
                value={form.completionDate}
                onChange={e => setForm({ ...form, completionDate: e.target.value })}
              />
            </div>

            {isSuperOrAdmin && (
              <div className="form-group">
                <label className="form-label">Job Value (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="form-control"
                  placeholder="e.g. 25000"
                  value={form.valueAmount}
                  onChange={e => setForm({ ...form, valueAmount: e.target.value })}
                />
              </div>
            )}
          </div>

          {/* Team Member Assignment (Client / Admin selectable, default Urna/Mansi) */}
          <div className="form-group">
            <label className="form-label">Assign Team Member (Lead / Owner)</label>
            <select
              className="form-select"
              value={form.assignedToUserId}
              onChange={e => {
                const uid = e.target.value;
                setForm({ ...form, assignedToUserId: uid });
                if (uid) {
                  setAssignments([{ userId: uid, revenuePercent: 100, hoursSpent: '' }]);
                }
              }}
            >
              <option value="">Auto-Assign (Urna / Mansi — Operations Leads)</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.name === 'Urna' || emp.name === 'Mansi' ? '★ (Operations Lead)' : `(${emp.departmentName || emp.role || 'Staff'})`}
                </option>
              ))}
            </select>
            <span className="form-hint" style={{ marginTop: '3px' }}>
              Jobs are automatically assigned to Urna & Mansi for triage, and can be delegated or shared with other team members.
            </span>
          </div>

          {/* Services Multi-Select Dropdown */}
          {servicesList.length > 0 && (
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
                {servicesList.map(s => (
                  <option key={s.id} value={s.id} disabled={selectedServiceIds.includes(s.id)}>
                    {s.name} ({s.referenceHours || s.reference_hours}h) {selectedServiceIds.includes(s.id) ? '✓ Attached' : ''}
                  </option>
                ))}
              </select>

              {/* Selected Service Badges */}
              {selectedServiceIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {selectedServiceIds.map(id => {
                    const s = servicesList.find(x => x.id === id);
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
          )}

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description / Scope of Work</label>
            <textarea
              className="form-textarea"
              rows={3}
              placeholder="Describe the deliverables, specifics, and client requirements..."
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Primary Category</label>
              <select
                className="form-select"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
              >
                {categories.map(cat => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Priority</label>
              <select
                className="form-select"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Team Assigned & Revenue / Hours Allocation */}
          {isSuperOrAdmin && employees.length > 0 && (
            <div className="form-group" style={{ background: 'var(--ci-surface)', padding: '14px', borderRadius: '10px', border: '1px solid var(--ci-border-light)' }}>
              <label className="form-label" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>People Assigned — % Revenue Credit & Hours Spent</span>
                <span className={`badge ${totalRevPercent === 100 ? 'badge-status-completed' : 'badge-priority-urgent'}`} style={{ fontSize: '11px' }}>
                  {totalRevPercent}% allocated {totalRevPercent === 100 ? '✓' : '(Must total 100%)'}
                </span>
              </label>

              {assignments.map((a, i) => (
                <div key={i} style={{ display: 'grid', gridToColumns: '1.6fr 1fr 1fr auto', gridTemplateColumns: '2fr 1.2fr 1.2fr auto', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <select
                    className="form-select"
                    style={{ height: '36px', fontSize: '12.5px' }}
                    value={a.userId}
                    onChange={e => updateAssignment(i, 'userId', e.target.value)}
                  >
                    <option value="">Select Team Member...</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="form-control"
                      style={{ height: '36px', fontSize: '12.5px' }}
                      placeholder="% Rev"
                      value={a.revenuePercent}
                      onChange={e => updateAssignment(i, 'revenuePercent', e.target.value)}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>%</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      className="form-control"
                      style={{ height: '36px', fontSize: '12.5px' }}
                      placeholder="Hours"
                      value={a.hoursSpent}
                      onChange={e => updateAssignment(i, 'hoursSpent', e.target.value)}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>hrs</span>
                  </div>

                  {assignments.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ color: 'var(--ci-danger)', height: '36px', padding: '0 10px' }}
                      onClick={() => removeAssignment(i)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: '4px', fontSize: '12px' }}
                onClick={addAssignee}
              >
                + Add Team Member
              </button>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Asset Link</label>
              <input
                type="text"
                className="form-control"
                placeholder="Google Drive, Dropbox or another secure URL"
                value={form.assetLink}
                onChange={e => setForm({ ...form, assetLink: e.target.value })}
              />
              <span className="form-hint">Google Drive, Dropbox or another secure URL</span>
            </div>

            <div className="form-group">
              <label className="form-label">Posted By</label>
              <input
                type="text"
                className="form-control"
                placeholder="Your full name"
                value={form.postedBy}
                onChange={e => setForm({ ...form, postedBy: e.target.value })}
                required
              />
            </div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTab('overview')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Submit & Log Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================================================
// 4. JOB LIST PAGE (ALL JOBS / MY JOBS)
// ==========================================================================

function JobsListPage({ data, reload }) {
  const jobs = data.jobs || [];
  const settings = data.settings || {};
  const isSuperOrAdmin = data.user?.role === 'admin' || data.user?.accountType === 'admin' || data.user?.accountType === 'super_admin';
  const employees = (data?.clientOwners || []).filter(u => u.accountType !== 'client' && u.role !== 'client');
  const currentUserId = data.user?.id;

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  // Editing Job Modal State
  const [editingJob, setEditingJob] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editOverrideHours, setEditOverrideHours] = useState('');
  const [editOverrideNote, setEditOverrideNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delegation Modal State
  const [delegatingJob, setDelegatingJob] = useState(null);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [delegateSharePercent, setDelegateSharePercent] = useState(100);
  const [delegateNote, setDelegateNote] = useState('');
  const [submittingDelegation, setSubmittingDelegation] = useState(false);

  // Rejection Modal State
  const [rejectingJob, setRejectingJob] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (categoryFilter && j.category !== categoryFilter) return false;
      if (priorityFilter && j.priority !== priorityFilter) return false;
      if (statusFilter && j.status !== statusFilter) return false;
      if (clientFilter && j.clientId !== clientFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = (j.title || '').toLowerCase().includes(q);
        const matchDesc = (j.description || '').toLowerCase().includes(q);
        const matchPosted = (j.postedBy || '').toLowerCase().includes(q);
        const matchAssigned = (j.assignedToName || '').toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchPosted && !matchAssigned) return false;
      }
      return true;
    });
  }, [jobs, categoryFilter, priorityFilter, statusFilter, clientFilter, search]);

  const openEditModal = job => {
    setEditingJob(job);
    setEditStatus(job.status);
    setEditOverrideHours(job.teamOverrideHours ?? '');
    setEditOverrideNote(job.teamOverrideNote ?? '');
  };

  const openDelegateModal = job => {
    setDelegatingJob(job);
    setDelegateUserId(employees[0]?.id || '');
    setDelegateSharePercent(100);
    setDelegateNote('');
  };

  const saveJobUpdate = async e => {
    e.preventDefault();
    if (!editingJob) return;
    try {
      setSavingEdit(true);
      await api.updateJob(editingJob.id, {
        status: editStatus,
        teamOverrideHours: editOverrideHours === '' ? null : Number(editOverrideHours),
        teamOverrideNote: editOverrideNote
      });
      setEditingJob(null);
      await reload();
    } catch (err) {
      alert(err.message || 'Failed to update job');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSendDelegation = async e => {
    e.preventDefault();
    if (!delegatingJob || !delegateUserId) return;
    try {
      setSubmittingDelegation(true);
      await api.delegateJob(delegatingJob.id, {
        delegatedToUserId: delegateUserId,
        sharePercent: Number(delegateSharePercent) || 100,
        note: delegateNote
      });
      setDelegatingJob(null);
      await reload();
    } catch (err) {
      alert(err.message || 'Failed to delegate job');
    } finally {
      setSubmittingDelegation(false);
    }
  };

  const handleAccept = async jobId => {
    try {
      await api.acceptDelegation(jobId);
      await reload();
    } catch (err) {
      alert(err.message || 'Failed to accept job');
    }
  };

  const handleRejectSubmit = async e => {
    e.preventDefault();
    if (!rejectingJob) return;
    try {
      setSubmittingReject(true);
      await api.rejectDelegation(rejectingJob.id, rejectReason);
      setRejectingJob(null);
      await reload();
    } catch (err) {
      alert(err.message || 'Failed to reject job');
    } finally {
      setSubmittingReject(false);
    }
  };

  return (
    <div>
      {/* FILTER TOOLBAR */}
      <div className="filter-toolbar">
        <div className="filter-search-box">
          <DashboardIcon name="search" />
          <input
            type="text"
            placeholder="Search by title, description, author or assignee..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {settings.categories?.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="Urgent">Urgent</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting_client">Waiting for Client</option>
          <option value="revision_requested">Revision Requested</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {isSuperOrAdmin && (
          <select
            className="filter-select"
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
          >
            <option value="">All Clients</option>
            {data.clients?.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* JOBS DATA TABLE */}
      <div className="data-table-container">
        {filteredJobs.length === 0 ? (
          <div className="empty-state-box">
            <p className="empty-state-title">No jobs found.</p>
            <p className="empty-state-text">Try adjusting your filters or search criteria.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Job Deliverable</th>
                {isSuperOrAdmin && <th>Client</th>}
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assigned Lead & Transfer</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => {
                const dueDate = addWorkingHours(
                  new Date(job.datePosted),
                  job.teamOverrideHours ?? job.calculatedHours,
                  settings
                );

                const isDelegationPending = job.delegationStatus === 'pending';
                const deadlineMs = job.delegationDeadline ? new Date(job.delegationDeadline).getTime() - Date.now() : 0;
                const hoursLeft = Math.max(0, Math.floor(deadlineMs / 3600000));
                const minsLeft = Math.max(0, Math.floor((deadlineMs % 3600000) / 60000));
                const isAssignedToMe = job.delegatedToUserId === currentUserId || job.assignedToUserId === currentUserId;
                const canTransfer = isSuperOrAdmin || job.assignedToUserId === currentUserId || job.createdByName === data.user?.name;

                return (
                  <tr key={job.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ color: 'var(--ci-text)', fontSize: '13.5px' }}>{job.title}</strong>
                        {job.assetLink && (
                          <a
                            href={job.assetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '11.5px', marginTop: '2px', color: 'var(--ci-info)' }}
                          >
                            View Asset Link ↗
                          </a>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', marginTop: '2px' }}>
                          Posted by: {job.postedBy}
                        </span>
                      </div>
                    </td>

                    {isSuperOrAdmin && (
                      <td style={{ fontWeight: 500, color: 'var(--ci-text)' }}>
                        {data.clients?.find(c => c.id === job.clientId)?.name || job.clientId}
                      </td>
                    )}

                    <td>
                      <span className="badge badge-category">{job.category}</span>
                    </td>

                    <td>
                      <span className={`badge ${priorityBadgeClasses[job.priority] || 'badge-priority-medium'}`}>
                        {job.priority}
                      </span>
                    </td>

                    <td>
                      <span className={`badge ${statusBadgeClasses[job.status] || 'badge-status-submitted'}`}>
                        {statusLabels[job.status] || job.status}
                      </span>
                    </td>

                    {/* Assigned Lead & 4-Hour Delegation Status */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--ci-navy)' }}>
                            {job.assignedToName || 'Urna (Auto-assigned Lead)'}
                          </span>
                        </div>

                        {/* Delegation Badges & Response Windows */}
                        {isDelegationPending && deadlineMs > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span className="badge badge-priority-urgent" style={{ fontSize: '10.5px', padding: '2px 6px' }}>
                              ⏳ Pending Accept ({hoursLeft}h {minsLeft}m left → Auto-confirms)
                            </span>
                            {job.delegatedToName && (
                              <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)' }}>
                                To: <strong>{job.delegatedToName}</strong> ({job.delegationSharePercent}% split)
                              </span>
                            )}
                            {(isAssignedToMe || isSuperOrAdmin) && (
                              <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--ci-success)', borderColor: 'var(--ci-success)' }}
                                  onClick={() => handleAccept(job.id)}
                                >
                                  ✓ Accept
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--ci-danger)' }}
                                  onClick={() => {
                                    setRejectingJob(job);
                                    setRejectReason('');
                                  }}
                                >
                                  ✕ Reject
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {job.delegationStatus === 'auto_accepted' && (
                          <span className="badge badge-status-completed" style={{ fontSize: '10.5px' }}>
                            ✓ Auto-Confirmed after 4h
                          </span>
                        )}

                        {job.delegationStatus === 'accepted' && (
                          <span className="badge badge-status-completed" style={{ fontSize: '10.5px' }}>
                            ✓ Confirmed by {job.delegatedToName || 'Assignee'}
                          </span>
                        )}

                        {job.delegationStatus === 'rejected' && (
                          <span className="badge badge-priority-urgent" style={{ fontSize: '10.5px' }} title={job.rejectionReason}>
                            ✕ Rejected (Returned to Lead)
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={{ fontWeight: 600, color: 'var(--ci-text)', fontSize: '12.5px' }}>
                      {formatDisplayDate(dueDate)}
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {canTransfer && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11.5px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                            title="Transfer or share work with another team member"
                            onClick={() => openDelegateModal(job)}
                          >
                            ↗ Transfer / Share
                          </button>
                        )}
                        {isSuperOrAdmin && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11.5px', padding: '3px 8px' }}
                            onClick={() => openEditModal(job)}
                          >
                            Manage
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* DELEGATE / TRANSFER WORK MODAL (4-HOUR WINDOW) */}
      {delegatingJob && (
        <div className="modal-backdrop" onClick={() => setDelegatingJob(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Transfer / Share Work: {delegatingJob.title}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDelegatingJob(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendDelegation}>
              <div className="modal-body">
                <div className="alert-banner info" style={{ marginBottom: '14px', fontSize: '12px' }}>
                  ℹ <strong>4-Hour Response Window:</strong> The assigned employee will have 4 hours to accept or reject. If 4 hours elapse without rejection, the work is automatically confirmed.
                </div>

                <div className="form-group">
                  <label className="form-label">Transfer / Share With Employee</label>
                  <select
                    className="form-select"
                    value={delegateUserId}
                    onChange={e => setDelegateUserId(e.target.value)}
                    required
                  >
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.departmentName || emp.role || 'Staff'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Work Allocation / Split Percentage</label>
                  <select
                    className="form-select"
                    value={delegateSharePercent}
                    onChange={e => setDelegateSharePercent(Number(e.target.value))}
                  >
                    <option value="100">100% — Full Job Transfer</option>
                    <option value="75">75% — Primary Lead Share</option>
                    <option value="50">50% — Equal 50/50 Sub-Task Split</option>
                    <option value="30">30% — Support / Sub-Task Share</option>
                    <option value="20">20% — Quality Control / Review Share</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Instructions / Scope Note for Assignee</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Describe specific tasks, deliverables, guidelines or handover notes..."
                    value={delegateNote}
                    onChange={e => setDelegateNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDelegatingJob(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingDelegation}
                >
                  {submittingDelegation ? 'Delegating...' : 'Send Delegation (4hr Window)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT DELEGATION MODAL */}
      {rejectingJob && (
        <div className="modal-backdrop" onClick={() => setRejectingJob(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Decline / Reject Assignment</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRejectingJob(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRejectSubmit}>
              <div className="modal-body">
                <p style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', marginBottom: '12px' }}>
                  Decline assignment for: <strong>{rejectingJob.title}</strong>. This job will immediately return to the delegating lead (Urna / Mansi).
                </p>

                <div className="form-group">
                  <label className="form-label">Reason for Declining</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Schedule capacity full, requires additional brief from client..."
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRejectingJob(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: 'var(--ci-danger)', borderColor: 'var(--ci-danger)' }}
                  disabled={submittingReject}
                >
                  {submittingReject ? 'Submitting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN EDIT JOB MODAL */}
      {editingJob && (
        <div className="modal-backdrop" onClick={() => setEditingJob(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Manage Job: {editingJob.title}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingJob(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={saveJobUpdate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Job Status</label>
                  <select
                    className="form-select"
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value)}
                  >
                    <option value="submitted">Submitted</option>
                    <option value="under_review">Under Review</option>
                    <option value="in_progress">In Progress</option>
                    <option value="waiting_client">Waiting for Client</option>
                    <option value="revision_requested">Revision Requested</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Team TAT Override Hours (optional)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="form-control"
                    placeholder={`Calculated default: ${editingJob.calculatedHours} hours`}
                    value={editOverrideHours}
                    onChange={e => setEditOverrideHours(e.target.value)}
                  />
                  <span className="form-hint">Leave blank to use automatic TAT calculation.</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Team TAT Override Note</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Reason for TAT adjustment..."
                    value={editOverrideNote}
                    onChange={e => setEditOverrideNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingJob(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// 5. TAT STANDARDS PAGE (ADMIN ONLY)
// ==========================================================================

function TatStandardsPage({ data, reload }) {
  const [settings, setSettings] = useState(() => data.settings || {
    categories: [],
    capacityPerCategory: 2,
    bufferHoursPerExtraJob: 8,
    startHour: 10.5,
    endHour: 19,
    workDays: [1, 2, 3, 4, 5]
  });

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const updateCategoryName = (idx, name) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.map((c, i) => i === idx ? { ...c, name } : c)
    }));
  };

  const updateCategoryHours = (idx, baseHours) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.map((c, i) => i === idx ? { ...c, baseHours: Number(baseHours) } : c)
    }));
  };

  const removeCategory = idx => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.filter((_, i) => i !== idx)
    }));
  };

  const addCategory = () => {
    setSettings(prev => ({
      ...prev,
      categories: [...prev.categories, { name: 'New category', baseHours: 24 }]
    }));
  };

  const handleSave = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      setSuccess('');
      await api.saveSettings(settings);
      await reload();
      setSuccess('TAT standards saved successfully!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      alert(err.message || 'Failed to save standards');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto' }}>
      <div className="saas-card">
        <div className="card-header">
          <h2 className="card-title">TAT Standards</h2>
        </div>

        {success && <div className="alert-banner success">{success}</div>}

        <form onSubmit={handleSave}>
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--ci-text)' }}>
              Category Base Hours
            </h3>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category Name</th>
                    <th>Base Hours</th>
                    <th style={{ width: '80px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.categories.map((cat, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          type="text"
                          className="form-control"
                          value={cat.name}
                          onChange={e => updateCategoryName(i, e.target.value)}
                          required
                        />
                      </td>
                      <td style={{ width: '140px' }}>
                        <input
                          type="number"
                          min="1"
                          className="form-control"
                          value={cat.baseHours}
                          onChange={e => updateCategoryHours(i, e.target.value)}
                          required
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ color: 'var(--ci-danger)' }}
                          onClick={() => removeCategory(i)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '12px' }}
              onClick={addCategory}
            >
              + Add Category
            </button>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category Capacity</label>
              <input
                type="number"
                min="1"
                className="form-control"
                value={settings.capacityPerCategory}
                onChange={e => setSettings({ ...settings, capacityPerCategory: Number(e.target.value) })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Extra Hours Over Capacity</label>
              <input
                type="number"
                min="0"
                className="form-control"
                value={settings.bufferHoursPerExtraJob}
                onChange={e => setSettings({ ...settings, bufferHoursPerExtraJob: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Hour (Decimal, e.g. 10.5 for 10:30 AM)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="24"
                className="form-control"
                value={settings.startHour}
                onChange={e => setSettings({ ...settings, startHour: Number(e.target.value) })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">End Hour (Decimal, e.g. 19 for 7:00 PM)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="24"
                className="form-control"
                value={settings.endHour}
                onChange={e => setSettings({ ...settings, endHour: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '16px' }}>
            <label className="form-label">Operating Working Days</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
              {[
                { day: 1, label: 'Mon' },
                { day: 2, label: 'Tue' },
                { day: 3, label: 'Wed' },
                { day: 4, label: 'Thu' },
                { day: 5, label: 'Fri' },
                { day: 6, label: 'Sat' },
                { day: 0, label: 'Sun' }
              ].map(d => {
                const isSelected = (settings.workDays || []).includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minWidth: '54px' }}
                    onClick={() => {
                      const newDays = isSelected
                        ? (settings.workDays || []).filter(x => x !== d.day)
                        : [...(settings.workDays || []), d.day];
                      setSettings({ ...settings, workDays: newDays });
                    }}
                  >
                    {isSelected ? '✓ ' : ''}{d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Standards'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================================================
// 6. MANAGE CLIENTS PAGE (ADMIN ONLY)
// ==========================================================================

function ManageClientsPage({ data, reload }) {
  const clients = data.clients || [];

  const [newClientId, setNewClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientPass, setNewClientPass] = useState('');
  const [newClientConfirm, setNewClientConfirm] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password reset modal
  const [resetModalClient, setResetModalClient] = useState(null);
  const [resetPass, setResetPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  const handleAddClient = async e => {
    e.preventDefault();
    if (!newClientId.trim() || !newClientName.trim()) return setError('Please fill all fields');
    if (newClientPass !== newClientConfirm) return setError('Passwords do not match');
    if (newClientPass.length < 8) return setError('Password must be at least 8 characters');

    try {
      setAdding(true);
      setError('');
      await api.createClient({
        id: newClientId.trim(),
        name: newClientName.trim(),
        password: newClientPass
      });
      setSuccess(`Client "${newClientName}" created successfully!`);
      setNewClientId('');
      setNewClientName('');
      setNewClientPass('');
      setNewClientConfirm('');
      await reload();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to create client');
    } finally {
      setAdding(false);
    }
  };

  const handleToggleStatus = async client => {
    const nextStatus = client.status === 'active' ? 'archived' : 'active';
    try {
      await api.updateClient(client.id, { status: nextStatus });
      await reload();
    } catch (err) {
      alert(err.message || 'Failed to update client status');
    }
  };

  const handleResetPassword = async e => {
    e.preventDefault();
    if (resetPass !== resetConfirm) return alert('Passwords do not match');
    if (resetPass.length < 8) return alert('Password must be at least 8 characters');
    try {
      setResetting(true);
      await api.updateClient(resetModalClient.id, { password: resetPass });
      setResetModalClient(null);
      setResetPass('');
      setResetConfirm('');
      alert('Password updated successfully!');
    } catch (err) {
      alert(err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ADD CLIENT CARD */}
      <div className="saas-card">
        <div className="card-header">
          <h2 className="card-title">Add Client</h2>
        </div>

        {error && <div className="alert-banner error">{error}</div>}
        {success && <div className="alert-banner success">{success}</div>}

        <form onSubmit={handleAddClient}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. acme_corp"
                value={newClientId}
                onChange={e => setNewClientId(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Acme Corporation"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Temporary Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Minimum 8 characters"
                value={newClientPass}
                onChange={e => setNewClientPass(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Re-enter password"
                value={newClientConfirm}
                onChange={e => setNewClientConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {adding ? 'Adding...' : '+ Add Client'}
            </button>
          </div>
        </form>
      </div>

      {/* CLIENTS TABLE */}
      <div className="saas-card">
        <div className="card-header">
          <h2 className="card-title">Clients Directory</h2>
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client ID</th>
                <th>Client Name</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
                <tr key={client.id}>
                  <td style={{ fontWeight: 600 }}>{client.id}</td>
                  <td>{client.name}</td>
                  <td>
                    <span className={`badge ${client.status === 'active' ? 'badge-status-completed' : 'badge-status-on-hold'}`}>
                      {client.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setResetModalClient(client)}
                      >
                        Reset Password
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${client.status === 'active' ? 'btn-secondary' : 'btn-primary'}`}
                        style={client.status === 'active' ? { color: 'var(--ci-danger)' } : {}}
                        onClick={() => handleToggleStatus(client)}
                      >
                        {client.status === 'active' ? 'Remove' : 'Restore'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RESET PASSWORD MODAL */}
      {resetModalClient && (
        <div className="modal-backdrop" onClick={() => setResetModalClient(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Reset Password: {resetModalClient.name}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setResetModalClient(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={resetPass}
                    onChange={e => setResetPass(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Confirm New Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={resetConfirm}
                    onChange={e => setResetConfirm(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setResetModalClient(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={resetting}
                >
                  {resetting ? 'Resetting...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// 7. LOGIN PAGE COMPONENT
// ==========================================================================

function LoginPage({ onLogin }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      const r = await api.login(id.trim(), password);
      setToken(r.token, remember);
      onLogin();
    } catch (err) {
      setError(err.message || 'Incorrect ID or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-wrap">
      <div className="auth-card-container">
        <div className="auth-brand-header">
          <h1>
            <span className="brand-navy">CI360</span>
            <span className="brand-gold">degrees</span>
          </h1>
          <p>Realtime Job Board</p>
        </div>

        <h2 className="auth-form-title">Job Board Sign In</h2>
        <p className="auth-form-sub">Sign in to access your workspace.</p>

        {error && <div className="alert-banner error">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Email or User ID</label>
            <input
              type="text"
              className="form-control"
              placeholder="name@company.com or workspace ID"
              value={id}
              onChange={e => setId(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-control"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="auth-remember-row">
            <label className="auth-remember-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span>Remember me</span>
            </label>
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
