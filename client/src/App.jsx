import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, getToken, setToken } from './api';
import { addWorkingHours } from './tat';
import SupportTickets from './SupportTickets';
import ci360LogoMark from './assets/ci360-logo-mark.png';
import './styles.css';
const statusLabels = { submitted: 'Submitted', under_review: 'Under Review', in_progress: 'In Progress', waiting_client: 'Waiting for Client', revision_requested: 'Revision Requested', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled' };
const fmt = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const openStatuses = new Set(['submitted', 'under_review', 'in_progress', 'waiting_client', 'revision_requested', 'on_hold']);
const priorityRank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const isPendingJob = job => openStatuses.has(job.status);
const isCompletedJob = job => job.status === 'completed';
const dateForMonth = job => job.dateCompleted || job.updatedAt || job.datePosted;
const monthKey = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = key => {
    if (key === 'Unknown')
        return 'Unknown date';
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const groupByMonth = (jobs, getDate) => jobs.reduce((groups, job) => {
    const key = monthKey(getDate(job));
    return { ...groups, [key]: [...(groups[key] || []), job] };
}, {});
const sortedMonthKeys = groups => Object.keys(groups).sort().reverse();
const clientNameFor = (data, id) => data.clients.find(c => c.id === id)?.name || id;
const can = (data, permission) => (data.permissions || data.user?.permissions || []).includes(permission);
const canAny = (data, permissions) => permissions.some(permission => can(data, permission));
const knownDashboardTabs = {
    overview: 'Overview',
    submit: 'Submit a Job',
    jobs: 'By Category',
    settings: 'TAT Standards',
    clients: 'Manage Clients',
    employees: 'Employees',
    users: 'Users & Roles',
    support: 'Support Tickets',
    audit: 'Audit Logs'
};
const fallbackModulesFor = data => data.user?.role === 'admin' || data.user?.accountType === 'admin' || data.user?.accountType === 'super_admin'
    ? [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'By Category'], ['settings', 'TAT Standards'], ['clients', 'Manage Clients'], ['support', 'Support Tickets']]
    : [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'By Category'], ['support', 'Support Tickets']];
const initialAuthMode = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('reset_token'))
        return 'reset';
    if (params.has('admin_invite') || params.has('admin_code') || window.location.hash === '#admin-signup')
        return 'signup';
    return 'login';
};
const passwordChecks = password => ({
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
});
const passwordScore = password => Object.values(passwordChecks(password)).filter(Boolean).length;
export default function App() {
    const [auth, setAuth] = useState(Boolean(getToken()));
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('overview');
    const [supportCreateSignal, setSupportCreateSignal] = useState(0);
    const load = useCallback(async () => { try {
        setData(await api.bootstrap());
        setError('');
    }
    catch (e) {
        if (e.message.includes('Session')) {
            setToken(null);
            setAuth(false);
        }
        else
            setError(e.message);
    } }, []);
    useEffect(() => { if (!auth)
        return; load(); const socket = io(API_URL || undefined); socket.on('data:changed', load); return () => { socket.disconnect(); }; }, [auth, load]);
    if (!auth)
        return _jsx(Login, { onLogin: () => setAuth(true) });
    if (!data)
        return _jsx("div", { className: "center", children: error || 'Loading workspace...' });
    const moduleTabs = (data.modules || [])
        .filter(module => knownDashboardTabs[module.id])
        .map(module => [module.id, module.label || knownDashboardTabs[module.id]]);
    const tabs = moduleTabs.length ? moduleTabs : fallbackModulesFor(data);
    const activeTab = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0] || 'overview';
    const logout = () => { setToken(null); setAuth(false); setData(null); };
    const openSupportTicketForm = () => {
        setSupportCreateSignal(value => value + 1);
        setTab('support');
    };
    const currentContent = activeTab === 'overview'
        ? _jsx(Overview, { data: data, setTab: setTab })
        : activeTab === 'submit' && can(data, 'jobs.create')
            ? _jsx(Submit, { data: data, reload: load })
            : activeTab === 'jobs' && canAny(data, ['jobs.view_all', 'jobs.view_own'])
                ? _jsx(Jobs, { data: data, reload: load })
                : activeTab === 'settings' && canAny(data, ['settings.view', 'settings.edit'])
                    ? _jsx(SettingsPanel, { initial: data.settings, reload: load })
                    : activeTab === 'clients' && canAny(data, ['clients.view_all', 'clients.view', 'clients.create'])
                        ? _jsx(Clients, { data: data, reload: load })
                        : activeTab === 'employees' && can(data, 'employees.view')
                            ? _jsx(Employees, { data: data })
                            : activeTab === 'users' && canAny(data, ['users.view', 'roles.view'])
                                ? _jsx(UsersRoles, { data: data, reload: load })
                                : activeTab === 'support' && canAny(data, ['support.view_all', 'support.view_own', 'support.create'])
                                    ? _jsx(SupportTickets, { data: data, reload: load, openCreateSignal: supportCreateSignal })
                                    : activeTab === 'audit' && can(data, 'audit.view')
                                        ? _jsx(AuditLogs, {})
                                        : _jsx(Overview, { data: data, setTab: setTab });
    return _jsx(DashboardShell, { data: data, tabs: tabs, tab: activeTab, setTab: setTab, logout: logout, error: error, openSupportTicketForm: openSupportTicketForm, children: currentContent });
}
function Login({ onLogin }) {
    const [mode, setMode] = useState(initialAuthMode);
    const showMode = next => {
        setMode(next);
        if (next === 'login')
            window.history.replaceState(null, '', window.location.pathname);
    };
    return _jsxs("div", { className: "auth-shell", children: [
            _jsxs("aside", { className: "auth-story", children: [
                    _jsx(AuthLogo, {}),
                    _jsxs("div", { className: "auth-story-copy", children: [_jsx("h1", { children: "Work requests, organised beautifully." }), _jsx("p", { children: "Submit jobs, follow turnaround times, collaborate with the team, and manage your projects from one secure workspace." })] }),
                    _jsx("div", { className: "auth-orbits", "aria-hidden": "true", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }),
                    _jsx("div", { className: "auth-story-foot", children: "Strategy \u2022 Creative \u2022 Technology" })
                ] }),
            _jsx("main", { className: "auth-panel", children: _jsxs("div", { className: "auth-card", children: [
                        _jsx("div", { className: "auth-mobile-logo", children: _jsx(AuthLogo, {}) }),
                        mode === 'login' && _jsx(LoginForm, { onLogin: onLogin, onMode: showMode }),
                        mode === 'forgot' && _jsx(ForgotPassword, { onMode: showMode }),
                        mode === 'reset' && _jsx(ResetPassword, { onMode: showMode }),
                        mode === 'signup' && _jsx(AdminSignup, { onMode: showMode })
                    ] }) })
        ] });
}
function AuthLogo() {
    return _jsx("div", { className: "auth-logo auth-logo-icon-only", children: _jsx("img", { src: ci360LogoMark, alt: "Workspace" }) });
}
function GoogleIcon() {
    return _jsxs("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: [_jsx("path", { fill: "#4285F4", d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" }), _jsx("path", { fill: "#34A853", d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" }), _jsx("path", { fill: "#FBBC05", d: "M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" }), _jsx("path", { fill: "#EA4335", d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" })] });
}
function LoginForm({ onLogin, onMode }) {
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        try {
            const r = await api.login(id.trim(), password);
            setToken(r.token, remember);
            onLogin();
        }
        catch (err) {
            setError(err.message);
        }
    };
    return _jsxs("form", { className: "auth-form", onSubmit: submit, children: [
            _jsx("div", { className: "auth-kicker", children: "CLIENT WORKSPACE" }),
            _jsx("h2", { children: "Welcome Back" }),
            _jsx("p", { className: "auth-subtitle", children: "Sign in to access your workspace." }),
            _jsxs("label", { children: ["Email Address", _jsx("input", { type: "text", value: id, onChange: e => setId(e.target.value), autoComplete: "username", placeholder: "name@company.com or admin ID", required: true })] }),
            _jsxs("label", { children: ["Password", _jsxs("div", { className: "password-field", children: [_jsx("input", { type: showPassword ? 'text' : 'password', value: password, onChange: e => setPassword(e.target.value), autoComplete: "current-password", required: true }), _jsx("button", { type: "button", onClick: () => setShowPassword(current => !current), children: showPassword ? 'Hide' : 'Show' })] })] }),
            _jsxs("div", { className: "auth-row", children: [_jsxs("label", { className: "remember-row", children: [_jsx("input", { type: "checkbox", checked: remember, onChange: e => setRemember(e.target.checked) }), "Remember me"] }), _jsx("button", { type: "button", className: "text-button", onClick: () => onMode('forgot'), children: "Forgot Password" })] }),
            error && _jsx("div", { className: "alert error", children: error }),
            _jsx("button", { className: "primary auth-primary", children: "Log in Securely" }),
            _jsxs("div", { className: "auth-divider", children: [_jsx("span", {}), "OR", _jsx("span", {})] }),
            _jsxs("button", { type: "button", className: "google-button", onClick: () => setError('Google sign in requires OAuth credentials before it can be enabled.'), children: [_jsx(GoogleIcon, {}), "Continue with Google"] }),
            _jsxs("p", { className: "auth-footnote", children: ["Protected by secure authentication.", _jsx("br", {}), _jsx("a", { href: "#privacy", children: "Privacy Policy" }), " \u00B7 ", _jsx("a", { href: "#terms", children: "Terms" })] })
        ] });
}
function ForgotPassword({ onMode }) {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    return _jsxs("form", { className: "auth-form", onSubmit: e => { e.preventDefault(); setSent(true); }, children: [
            _jsx("div", { className: "auth-kicker", children: "PASSWORD RECOVERY" }),
            _jsx("h2", { children: "Forgot your password?" }),
            _jsx("p", { className: "auth-subtitle", children: "Enter your email address. If it matches a workspace account, reset instructions will be sent." }),
            _jsxs("label", { children: ["Email", _jsx("input", { type: "email", value: email, onChange: e => setEmail(e.target.value), autoComplete: "email", required: true })] }),
            sent && _jsxs("div", { className: "alert success", children: [_jsx("b", { children: "Check your inbox." }), _jsx("br", {}), "Password reset instructions will arrive if email delivery is configured for this workspace."] }),
            _jsx("button", { className: "primary auth-primary", children: "Send Reset Link" }),
            _jsx("button", { type: "button", className: "text-button back-button", onClick: () => onMode('login'), children: "Back to Login" })
        ] });
}
function ResetPassword({ onMode }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState('');
    const score = passwordScore(password);
    const checks = passwordChecks(password);
    const submit = e => {
        e.preventDefault();
        if (password !== confirm)
            return setMessage('Passwords do not match.');
        if (score < 5)
            return setMessage('Password does not meet all strength requirements.');
        setMessage('Password reset endpoint is ready for integration. Connect the secure reset token API to activate this action.');
    };
    return _jsxs("form", { className: "auth-form", onSubmit: submit, children: [
            _jsx("div", { className: "auth-kicker", children: "SECURE RESET" }),
            _jsx("h2", { children: "Reset Password" }),
            _jsx("p", { className: "auth-subtitle", children: "Create a strong password for your workspace account." }),
            _jsxs("label", { children: ["New Password", _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), autoComplete: "new-password", required: true })] }),
            _jsxs("div", { className: "strength-meter", children: [_jsx("span", { style: { width: `${score * 20}%` } }), _jsx("small", { children: score >= 5 ? 'Strong password' : 'Password strength' })] }),
            _jsx("ul", { className: "password-rules", children: [['length', 'Minimum 8 characters'], ['upper', 'Uppercase'], ['lower', 'Lowercase'], ['number', 'Number'], ['special', 'Special character']].map(([key, label]) => _jsx("li", { className: checks[key] ? 'met' : '', children: label }, key)) }),
            _jsxs("label", { children: ["Confirm Password", _jsx("input", { type: "password", value: confirm, onChange: e => setConfirm(e.target.value), autoComplete: "new-password", required: true })] }),
            message && _jsx("div", { className: message.includes('ready') ? 'alert success' : 'alert error', children: message }),
            _jsx("button", { className: "primary auth-primary", children: "Update Password" }),
            _jsx("button", { type: "button", className: "text-button back-button", onClick: () => onMode('login'), children: "Go to Login" })
        ] });
}
function AdminSignup({ onMode }) {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('admin_invite') || params.get('admin_code') || '';
    const [message, setMessage] = useState('');
    if (!invite || invite.length < 8)
        return _jsxs("div", { className: "auth-form access-denied", children: [_jsx("div", { className: "auth-kicker", children: "403 ACCESS DENIED" }), _jsx("h2", { children: "Restricted Admin Signup" }), _jsx("p", { className: "auth-subtitle", children: "Only a Super Admin can create new Admin accounts. A valid invitation token or secret admin access code is required." }), _jsx("button", { type: "button", className: "primary auth-primary", onClick: () => onMode('login'), children: "Return to Login" })] });
    return _jsxs("form", { className: "auth-form", onSubmit: e => { e.preventDefault(); setMessage('Admin invitation UI is ready. Connect the invitation validation endpoint before enabling account creation.'); }, children: [
            _jsx("div", { className: "auth-kicker", children: "ADMIN INVITATION" }),
            _jsx("h2", { children: "Create Admin Account" }),
            _jsx("p", { className: "auth-subtitle", children: "Restricted workspace setup for invited administrators." }),
            _jsxs("label", { children: ["Admin Invitation Token", _jsx("input", { value: invite, readOnly: true })] }),
            _jsxs("div", { className: "auth-grid", children: [_jsxs("label", { children: ["Full Name", _jsx("input", { required: true })] }), _jsxs("label", { children: ["Company Name", _jsx("input", { required: true })] })] }),
            _jsxs("div", { className: "auth-grid", children: [_jsxs("label", { children: ["Email", _jsx("input", { type: "email", required: true })] }), _jsxs("label", { children: ["Phone Number", _jsx("input", { type: "tel", required: true })] })] }),
            _jsxs("div", { className: "auth-grid", children: [_jsxs("label", { children: ["Password", _jsx("input", { type: "password", required: true })] }), _jsxs("label", { children: ["Confirm Password", _jsx("input", { type: "password", required: true })] })] }),
            _jsxs("label", { children: ["Role", _jsx("input", { value: "Admin", readOnly: true })] }),
            _jsxs("button", { type: "button", className: "google-button", children: [_jsx(GoogleIcon, {}), "Link Google Account (Optional)"] }),
            message && _jsx("div", { className: "alert success", children: message }),
            _jsx("button", { className: "primary auth-primary", children: "Create Admin Account" })
        ] });
}
const dashboardTabIcons = { overview: 'overview', submit: 'submit', jobs: 'jobs', settings: 'clock', clients: 'users', employees: 'users', users: 'users', support: 'support', audit: 'document' };
const dashboardTabDescriptions = {
    overview: 'Workspace summary',
    submit: 'Create a request',
    jobs: 'Browse every job',
    settings: 'Turnaround rules',
    clients: 'Client access',
    employees: 'Internal team',
    users: 'Roles and access',
    support: 'Help and tickets',
    audit: 'Activity history'
};
const dashboardDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return 'Date unavailable';
    return date.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};
const shortDateTime = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return 'Date unavailable';
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const timestamp = value => {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
};
const initialsFor = value => (value || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
function DashboardIcon({ name }) {
    const paths = {
        overview: ['M4 13h6V4H4z', 'M14 20h6v-9h-6z', 'M4 20h6v-4H4z', 'M14 8h6V4h-6z'],
        submit: ['M12 5v14', 'M5 12h14', 'M5 4h14v16H5z'],
        jobs: ['M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M4 7h16v12H4z', 'M9 12h6'],
        clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
        users: ['M16 18a4 4 0 0 0-8 0', 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 18a3.5 3.5 0 0 0-3-3.45', 'M17 5.3a2.6 2.6 0 0 1 0 5.4'],
        support: ['M5 18v-5a7 7 0 0 1 14 0v5', 'M5 18h3v-5H5z', 'M16 18h3v-5h-3z', 'M16 19a4 4 0 0 1-8 0'],
        bell: ['M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z', 'M10 20a2 2 0 0 0 4 0'],
        menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
        chevron: ['M9 6l6 6-6 6'],
        calendar: ['M7 3v4', 'M17 3v4', 'M4 8h16', 'M5 5h14v16H5z'],
        plus: ['M12 5v14', 'M5 12h14'],
        arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
        total: ['M7 7h10', 'M7 12h10', 'M7 17h10', 'M4 4h16v16H4z'],
        pending: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v6l4 2'],
        completed: ['M20 6L9 17l-5-5', 'M21 12a9 9 0 1 1-3.2-6.9'],
        document: ['M7 3h7l5 5v13H7z', 'M14 3v6h5', 'M10 14h6', 'M10 18h4'],
        moon: ['M21 14.4A8.6 8.6 0 0 1 9.6 3 7 7 0 1 0 21 14.4z'],
        sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M4.93 19.07l1.41-1.41', 'M17.66 6.34l1.41-1.41']
    };
    return _jsx("svg", { className: "dashboard-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (paths[name] || paths.overview).map((d, index) => _jsx("path", { d: d }, index)) });
}
function DashboardShell({ data, tabs, tab, setTab, logout, error, openSupportTicketForm, children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [notificationOpen, setNotificationOpen] = useState(false);
    const [theme, setTheme] = useState(() => {
        try {
            return localStorage.getItem('ci360-theme') === 'dark' ? 'dark' : 'light';
        }
        catch {
            return 'light';
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem('ci360-theme', theme);
        }
        catch { }
    }, [theme]);
    const openTickets = (data.supportTickets || []).filter(ticket => !['Resolved', 'Closed'].includes(ticket.status)).length;
    const urgentJobs = data.jobs.filter(job => isPendingJob(job) && job.priority === 'Urgent').length;
    const notificationCount = Math.min(openTickets + urgentJobs, 99);
    const activities = recentActivityItems(data);
    const activeLabel = tabs.find(([id]) => id === tab)?.[1] || 'Dashboard';
    const goTo = id => {
        setTab(id);
        setSidebarOpen(false);
        setUserMenuOpen(false);
        setNotificationOpen(false);
    };
    return _jsxs("main", { className: `dashboard-shell theme-${theme} ${sidebarOpen ? 'sidebar-open' : ''}`, children: [
            _jsx("button", { type: "button", className: "dashboard-backdrop", "aria-label": "Close navigation", onClick: () => setSidebarOpen(false) }),
            _jsxs("aside", { id: "dashboard-sidebar", className: "dashboard-sidebar", "aria-label": "Dashboard navigation", children: [
                    _jsx("div", { className: "dashboard-brand dashboard-brand-icon-only", children: _jsx("img", { src: ci360LogoMark, alt: "Workspace" }) }),
                    _jsx("div", { className: "dashboard-nav", role: "navigation", "aria-label": "Dashboard tabs", children: tabs.map(([id, label]) => _jsxs("button", { type: "button", className: tab === id ? 'active' : '', onClick: () => goTo(id), "aria-current": tab === id ? 'page' : undefined, children: [_jsx(DashboardIcon, { name: dashboardTabIcons[id] || 'overview' }), _jsxs("span", { children: [_jsx("b", { children: label }), _jsx("small", { children: dashboardTabDescriptions[id] || 'Open section' })] })] }, id)) }),
                    _jsxs("div", { className: "dashboard-sidebar-footer", children: [_jsxs("div", { className: "dashboard-support-card", children: [_jsx(DashboardIcon, { name: "support" }), _jsx("b", { children: "Need Help?" }), _jsx("p", { children: "Our support team is here to help you." }), _jsx("button", { type: "button", onClick: () => { setSidebarOpen(false); setUserMenuOpen(false); setNotificationOpen(false); openSupportTicketForm(); }, children: "Create Ticket" })] }), _jsxs("p", { className: "dashboard-copyright", children: ["\u00A9 ", new Date().getFullYear(), _jsx("span", { children: "All rights reserved." })] })] })
                ] }),
            _jsxs("section", { className: "dashboard-main", children: [
                    _jsxs("div", { className: "dashboard-topbar", children: [
                            _jsxs("div", { className: "dashboard-topbar-left", children: [_jsx("button", { type: "button", className: "dashboard-menu", "aria-label": sidebarOpen ? "Close navigation" : "Open navigation", "aria-controls": "dashboard-sidebar", "aria-expanded": sidebarOpen, onClick: () => setSidebarOpen(open => !open), children: _jsx(DashboardIcon, { name: "menu" }) }), _jsxs("div", { children: [_jsx("span", { children: activeLabel }), _jsx("strong", { children: "Workspace" })] })] }),
                            _jsxs("div", { className: "dashboard-user-area", children: [
                                    _jsx("button", { type: "button", className: "dashboard-theme-toggle", "aria-label": theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', onClick: () => setTheme(current => current === 'dark' ? 'light' : 'dark'), children: _jsx(DashboardIcon, { name: theme === 'dark' ? 'sun' : 'moon' }) }),
                                    _jsxs("div", { className: "dashboard-notification-wrap", children: [_jsxs("button", { type: "button", className: "dashboard-notification", "aria-label": "Open latest activity", "aria-expanded": notificationOpen, onClick: () => { setNotificationOpen(open => !open); setUserMenuOpen(false); }, children: [_jsx(DashboardIcon, { name: "bell" }), notificationCount > 0 && _jsx("span", { children: notificationCount })] }), notificationOpen && _jsxs("div", { className: "dashboard-notification-menu", role: "dialog", "aria-label": "Latest activity", children: [_jsxs("div", { className: "dashboard-notification-head", children: [_jsx("b", { children: "Latest Activity" }), _jsxs("span", { children: [notificationCount, " open notice", notificationCount === 1 ? '' : 's'] })] }), activities.length ? _jsx("div", { className: "dashboard-activity-list compact", children: activities.map(item => _jsxs("button", { type: "button", className: `dashboard-activity ${item.tone}`, onClick: () => goTo(item.tab), children: [_jsx("span", { className: "dashboard-activity-dot" }), _jsxs("span", { children: [_jsx("b", { children: item.description }), _jsx("small", { children: shortDateTime(item.date) })] })] }, item.id)) }) : _jsx(DashboardEmptyState, { title: "No recent activity.", body: "Latest job, ticket, and client updates will appear here." }), _jsx("button", { type: "button", className: "dashboard-open-overview", onClick: () => goTo('overview'), children: "Open Dashboard" })] })] }),
                                    _jsxs("div", { className: "dashboard-user-menu-wrap", children: [_jsxs("button", { type: "button", className: "dashboard-user-button", "aria-expanded": userMenuOpen, onClick: () => { setUserMenuOpen(open => !open); setNotificationOpen(false); }, children: [_jsx("span", { className: "dashboard-avatar", children: initialsFor(data.user.name) }), _jsx("span", { children: data.user.name }), _jsx(DashboardIcon, { name: "chevron" })] }), userMenuOpen && _jsxs("div", { className: "dashboard-user-menu", role: "menu", children: [_jsxs("div", { children: [_jsx("b", { children: data.user.name }), _jsx("span", { children: data.user.roleName || data.user.accountType || 'Workspace user' })] }), _jsx("button", { type: "button", role: "menuitem", onClick: logout, children: "Log out" })] })] })
                                ] })
                        ] }),
                    error && _jsx("div", { className: "alert error dashboard-alert", children: error }),
                    _jsx("div", { className: "dashboard-content", children: children })
                ] })
        ] });
}
function DashboardStat({ tone, icon, value, label, support }) {
    return _jsxs("article", { className: `dashboard-stat ${tone}`, children: [_jsx("span", { className: "dashboard-stat-icon", children: _jsx(DashboardIcon, { name: icon }) }), _jsxs("div", { children: [_jsx("strong", { children: value }), _jsx("span", { children: label }), _jsx("small", { children: support })] })] });
}
function DashboardEmptyState({ title, body }) {
    return _jsxs("div", { className: "dashboard-empty", children: [_jsx("span", { children: _jsx(DashboardIcon, { name: "document" }) }), _jsx("b", { children: title }), _jsx("p", { children: body })] });
}
function recentActivityItems(data) {
    const jobItems = data.jobs.map(job => {
        const completed = isCompletedJob(job);
        const verb = completed ? 'completed' : job.status === 'submitted' ? 'submitted' : 'updated';
        const date = completed ? dateForMonth(job) : job.updatedAt || job.datePosted;
        return { id: `job-${job.id}`, tab: 'jobs', tone: completed ? 'success' : job.priority === 'Urgent' ? 'urgent' : 'blue', description: `Job "${job.title}" ${verb}`, date };
    });
    const ticketItems = (data.supportTickets || []).map(ticket => ({ id: `ticket-${ticket.ticketNumber}`, tab: 'support', tone: ticket.status === 'Resolved' || ticket.status === 'Closed' ? 'success' : 'purple', description: `Ticket "${ticket.subject}" ${ticket.status === 'Open' ? 'created' : 'updated'}`, date: ticket.updatedAt || ticket.createdAt }));
    const clientItems = canAny(data, ['clients.view_all', 'clients.view']) ? data.clients.map(client => ({ id: `client-${client.id}`, tab: 'clients', tone: 'gold', description: `Client "${client.name}" added`, date: client.createdAt })) : [];
    return [...jobItems, ...ticketItems, ...clientItems].filter(item => timestamp(item.date)).sort((a, b) => timestamp(b.date) - timestamp(a.date)).slice(0, 5);
}
function Overview({ data, setTab }) {
    const [client, setClient] = useState('');
    const [pendingMonth, setPendingMonth] = useState('');
    const [completedMonth, setCompletedMonth] = useState('');
    const jobs = useMemo(() => client ? data.jobs.filter(job => job.clientId === client) : data.jobs, [data.jobs, client]);
    const pendingJobs = useMemo(() => jobs.filter(isPendingJob).sort((a, b) => {
        const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
        return priorityDiff || timestamp(a.datePosted) - timestamp(b.datePosted);
    }), [jobs]);
    const completedJobs = useMemo(() => jobs.filter(isCompletedJob).sort((a, b) => timestamp(dateForMonth(b)) - timestamp(dateForMonth(a))), [jobs]);
    const pendingMonths = useMemo(() => sortedMonthKeys(groupByMonth(pendingJobs, job => job.datePosted)), [pendingJobs]);
    const completedMonths = useMemo(() => sortedMonthKeys(groupByMonth(completedJobs, dateForMonth)), [completedJobs]);
    useEffect(() => { if (pendingMonth && !pendingMonths.includes(pendingMonth))
        setPendingMonth(''); }, [pendingMonth, pendingMonths]);
    useEffect(() => { if (completedMonth && !completedMonths.includes(completedMonth))
        setCompletedMonth(''); }, [completedMonth, completedMonths]);
    const visiblePending = pendingMonth ? pendingJobs.filter(job => monthKey(job.datePosted) === pendingMonth) : pendingJobs;
    const visibleCompleted = completedMonth ? completedJobs.filter(job => monthKey(dateForMonth(job)) === completedMonth) : completedJobs;
    const canSeeClients = canAny(data, ['clients.view_all', 'clients.view']);
    const activeClients = canSeeClients ? data.clients.filter(client => client.status === 'active').length : data.user.clientId ? 1 : 0;
    const quickActions = [
        ...(can(data, 'jobs.create') ? [['submit', 'plus', 'Submit a Job', 'Create a new job request']] : []),
        ...(canAny(data, ['jobs.view_all', 'jobs.view_own']) ? [['jobs', 'jobs', 'View All Jobs', 'Browse all your jobs']] : []),
        ...(canSeeClients ? [['clients', 'users', 'Manage Clients', 'View and manage clients']] : []),
        ...(canAny(data, ['support.view_all', 'support.view_own', 'support.create']) ? [['support', 'support', 'Support Tickets', 'Get help and support']] : [])
    ];
    const activities = recentActivityItems(data);
    return _jsxs(_Fragment, { children: [
            _jsxs("section", { className: "dashboard-welcome-card", children: [
                    _jsxs("div", { children: [_jsxs("h2", { children: ["Welcome back, ", data.user.name, "!"] }), _jsx("p", { children: "Here's what's happening with your jobs today." })] }),
                    _jsxs("div", { className: "dashboard-date-box", children: [_jsx(DashboardIcon, { name: "calendar" }), _jsx("span", { children: dashboardDate(new Date()) })] })
                ] }),
            _jsxs("section", { className: "dashboard-stats", "aria-label": "Dashboard statistics", children: [
                    _jsx(DashboardStat, { tone: "blue", icon: "total", value: data.jobs.length, label: "Total Jobs", support: "All time jobs posted" }),
                    _jsx(DashboardStat, { tone: "gold", icon: "pending", value: data.jobs.filter(isPendingJob).length, label: "Pending Jobs", support: "Awaiting completion" }),
                    _jsx(DashboardStat, { tone: "green", icon: "completed", value: data.jobs.filter(isCompletedJob).length, label: "Completed Jobs", support: "Successfully delivered" }),
                    _jsx(DashboardStat, { tone: "purple", icon: "users", value: activeClients, label: canSeeClients ? 'Active Clients' : 'Workspace', support: canSeeClients ? 'Active clients' : 'Your client access' })
                ] }),
            _jsxs("section", { className: "dashboard-work-grid", children: [
                    _jsxs("div", { className: "dashboard-work-left", children: [
                            _jsxs("article", { className: "dashboard-card dashboard-jobs-card", children: [
                                    _jsxs("div", { className: "dashboard-card-head", children: [_jsxs("div", { children: [_jsx("h3", { children: "Pending Jobs" }), _jsx("p", { children: "Jobs awaiting completion, by month posted" })] }), _jsxs("span", { className: "dashboard-count-pill", children: [visiblePending.length, visiblePending.length === 1 ? ' Job' : ' Jobs'] })] }),
                                    _jsxs("div", { className: "dashboard-filter-row", children: [
                                            canSeeClients && _jsxs("select", { value: client, onChange: e => setClient(e.target.value), "aria-label": "Filter jobs by client", children: [_jsx("option", { value: "", children: "All clients" }), data.clients.map(c => _jsx("option", { value: c.id, children: c.name }, c.id))] }),
                                            _jsxs("select", { value: pendingMonth, onChange: e => setPendingMonth(e.target.value), "aria-label": "Filter pending jobs by month", children: [_jsx("option", { value: "", children: "All pending months" }), pendingMonths.map(key => _jsx("option", { value: key, children: monthLabel(key) }, key))] })
                                        ] }),
                                    visiblePending.length ? _jsx("div", { className: "jobs dashboard-overview-jobs", children: visiblePending.map(job => _jsx(JobCard, { job: job, data: data }, job.id)) }) : _jsx(DashboardEmptyState, { title: "Nothing pending yet.", body: "New active jobs will appear here once submitted." }),
                                    _jsx("div", { className: "dashboard-card-action", children: _jsxs("button", { type: "button", onClick: () => setTab('jobs'), children: ["View all pending jobs", _jsx(DashboardIcon, { name: "chevron" })] }) })
                                ] }),
                            _jsxs("article", { className: "dashboard-card dashboard-jobs-card", children: [
                                    _jsxs("div", { className: "dashboard-card-head", children: [_jsxs("div", { children: [_jsx("h3", { children: "Completed Jobs" }), _jsx("p", { children: "Jobs completed, by month finished" })] }), _jsxs("span", { className: "dashboard-count-pill", children: [visibleCompleted.length, visibleCompleted.length === 1 ? ' Job' : ' Jobs'] })] }),
                                    completedJobs.length > 0 && _jsx("div", { className: "dashboard-filter-row", children: _jsxs("select", { value: completedMonth, onChange: e => setCompletedMonth(e.target.value), "aria-label": "Filter completed jobs by month", children: [_jsx("option", { value: "", children: "All completed months" }), completedMonths.map(key => _jsx("option", { value: key, children: monthLabel(key) }, key))] }) }),
                                    visibleCompleted.length ? _jsx("div", { className: "jobs dashboard-overview-jobs", children: visibleCompleted.map(job => _jsx(JobCard, { job: job, data: data }, job.id)) }) : _jsx(DashboardEmptyState, { title: "Nothing completed yet.", body: "Completed jobs will appear here once finished." })
                                ] })
                        ] }),
                    _jsxs("aside", { className: "dashboard-work-right", children: [
                            _jsxs("article", { className: "dashboard-card dashboard-side-card", children: [_jsx("h3", { children: "Quick Actions" }), _jsx("div", { className: "dashboard-action-list", children: quickActions.map(([id, icon, title, description]) => _jsxs("button", { type: "button", onClick: () => setTab(id), children: [_jsx("span", { children: _jsx(DashboardIcon, { name: icon }) }), _jsxs("span", { children: [_jsx("b", { children: title }), _jsx("small", { children: description })] }), _jsx(DashboardIcon, { name: "chevron" })] }, id)) })] }),
                            _jsxs("article", { className: "dashboard-card dashboard-side-card", children: [_jsx("h3", { children: "Recent Activity" }), activities.length ? _jsx("div", { className: "dashboard-activity-list", children: activities.map(item => _jsxs("button", { type: "button", className: `dashboard-activity ${item.tone}`, onClick: () => setTab(item.tab), children: [_jsx("span", { className: "dashboard-activity-dot" }), _jsxs("span", { children: [_jsx("b", { children: item.description }), _jsx("small", { children: shortDateTime(item.date) })] })] }, item.id)) }) : _jsx(DashboardEmptyState, { title: "No recent activity.", body: "Job, ticket, and client updates will appear here." })] })
                        ] })
                ] })
        ] });
}
function MonthGroups({ groups, data, empty, editable = false, reload, sortDate = dateForMonth }) {
    const keys = sortedMonthKeys(groups);
    if (!keys.length)
        return _jsx("div", { className: "empty", children: empty });
    return _jsx(_Fragment, { children: keys.map(key => {
            const list = [...groups[key]].sort((a, b) => new Date(sortDate(b)).getTime() - new Date(sortDate(a)).getTime());
            return _jsxs("section", { className: "month-group", children: [_jsxs("h4", { children: [monthLabel(key), " ", _jsxs("span", { children: ["(", list.length, ")"] })] }), _jsx("div", { className: "jobs", children: list.map(job => _jsx(JobCard, { job: job, data: data, editable: editable, reload: reload }, job.id)) })] }, key);
        }) });
}
function Metric({ label, value }) { return _jsxs("div", { className: "metric", children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }); }
function Submit({ data, reload }) { const first = data.settings.categories[0]?.name || ''; const [form, setForm] = useState({ clientId: data.clients.find(c => c.status === 'active')?.id || '', title: '', description: '', category: first, priority: 'Medium', postedBy: '', assetLink: '' }); const [message, setMessage] = useState(''); const submit = async (e) => { e.preventDefault(); try {
    await api.createJob(form);
    setMessage('Job submitted successfully. All logged-in users will receive the update instantly.');
    setForm({ ...form, title: '', description: '', postedBy: '', assetLink: '' });
    await reload();
}
catch (err) {
    setMessage(err.message);
} }; return _jsxs("form", { className: "card form", onSubmit: submit, children: [_jsx("h2", { children: "New job request" }), message && _jsx("div", { className: "alert", children: message }), can(data, 'clients.view_all') && _jsxs("label", { children: ["Client", _jsx("select", { value: form.clientId, onChange: e => setForm({ ...form, clientId: e.target.value }), children: data.clients.filter(c => c.status === 'active').map(c => _jsx("option", { value: c.id, children: c.name }, c.id)) })] }), _jsxs("label", { children: ["Job title", _jsx("input", { required: true, value: form.title, onChange: e => setForm({ ...form, title: e.target.value }) })] }), _jsxs("label", { children: ["Description", _jsx("textarea", { value: form.description, onChange: e => setForm({ ...form, description: e.target.value }) })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category", _jsx("select", { value: form.category, onChange: e => setForm({ ...form, category: e.target.value }), children: data.settings.categories.map(c => _jsx("option", { children: c.name }, c.name)) })] }), _jsxs("label", { children: ["Priority", _jsxs("select", { value: form.priority, onChange: e => setForm({ ...form, priority: e.target.value }), children: [_jsx("option", { children: "Low" }), _jsx("option", { children: "Medium" }), _jsx("option", { children: "High" }), _jsx("option", { children: "Urgent" })] })] })] }), _jsxs("label", { children: ["Asset link", _jsx("input", { value: form.assetLink, onChange: e => setForm({ ...form, assetLink: e.target.value }), placeholder: "Google Drive, Dropbox or another secure URL" })] }), _jsxs("label", { children: ["Posted by", _jsx("input", { required: true, value: form.postedBy, onChange: e => setForm({ ...form, postedBy: e.target.value }) })] }), _jsx("button", { className: "primary", children: "Submit job" })] }); }
function Jobs({ data, reload }) {
    const [category, setCategory] = useState('');
    const [priority, setPriority] = useState('');
    const [client, setClient] = useState('');
    const resetFilters = () => {
        setCategory('');
        setPriority('');
        setClient('');
    };
    const filtered = useMemo(() => data.jobs.filter(job => (!category || job.category === category) && (!priority || job.priority === priority) && (!client || job.clientId === client)), [data.jobs, category, priority, client]);
    const pending = useMemo(() => filtered.filter(isPendingJob).sort((a, b) => {
        const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
        return priorityDiff || new Date(a.datePosted).getTime() - new Date(b.datePosted).getTime();
    }), [filtered]);
    const completed = useMemo(() => filtered.filter(isCompletedJob).sort((a, b) => new Date(dateForMonth(b)).getTime() - new Date(dateForMonth(a)).getTime()), [filtered]);
    return _jsxs(_Fragment, { children: [
            _jsx(CategoryLoadGrid, { data: data }),
            _jsxs("div", { className: "filters", children: [
                    _jsxs("select", { value: category, onChange: e => setCategory(e.target.value), children: [_jsx("option", { value: "", children: "All categories" }), data.settings.categories.map(c => _jsx("option", { children: c.name }, c.name))] }),
                    _jsxs("select", { value: priority, onChange: e => setPriority(e.target.value), children: [_jsx("option", { value: "", children: "All priorities" }), ['Urgent', 'High', 'Medium', 'Low'].map(p => _jsx("option", { children: p }, p))] }),
                    can(data, 'clients.view_all') && _jsxs("select", { value: client, onChange: e => setClient(e.target.value), children: [_jsx("option", { value: "", children: "All clients" }), data.clients.map(c => _jsx("option", { value: c.id, children: c.name }, c.id))] }),
                    _jsx("button", { type: "button", onClick: resetFilters, children: "Reset filters" })
                ] }),
            _jsxs("h3", { className: "section-heading", children: ["Pending ", _jsxs("span", { children: ["(", pending.length, ")"] })] }),
            pending.length ? _jsx("div", { className: "jobs", children: pending.map(job => _jsx(JobCard, { job: job, data: data, editable: true, reload: reload }, job.id)) }) : _jsx("div", { className: "empty", children: "No pending jobs match these filters." }),
            _jsxs("h3", { className: "section-heading section-heading-spaced", children: ["Completed ", _jsxs("span", { children: ["(", completed.length, ")"] })] }),
            completed.length ? _jsx("div", { className: "jobs", children: completed.map(job => _jsx(JobCard, { job: job, data: data, editable: true, reload: reload }, job.id)) }) : _jsx("div", { className: "empty", children: "Nothing completed yet." })
        ] });
}
function CategoryLoadGrid({ data }) {
    return _jsx("div", { className: "load-grid category-load-grid", children: data.settings.categories.map(category => {
            const count = data.categoryLoad[category.name] || 0;
            const capacity = data.settings.capacityPerCategory;
            const pct = Math.min(100, Math.round(count / Math.max(1, capacity) * 100));
            return _jsxs("div", { className: `load ${count > capacity ? 'over' : ''}`, children: [_jsx("b", { children: category.name }), _jsx("div", { className: "meter", children: _jsx("i", { style: { width: pct + '%' } }) }), _jsxs("span", { children: [count, " pending \u00B7 comfortable capacity ", capacity] })] }, category.name);
        }) });
}
function JobCard({ job, data, editable = false, reload }) {
    const [status, setStatus] = useState(job.status);
    const [hours, setHours] = useState(job.teamOverrideHours ?? job.calculatedHours);
    const [note, setNote] = useState(job.teamOverrideNote || '');
    const [assignee, setAssignee] = useState(job.assignedToUserId || '');
    const [department, setDepartment] = useState(job.departmentId || '');
    const [assignmentNote, setAssignmentNote] = useState(job.assignmentNote || '');
    const effectiveHours = job.teamOverrideHours ?? job.calculatedHours;
    const due = addWorkingHours(new Date(job.datePosted), effectiveHours, data.settings);
    const completed = isCompletedJob(job);
    const teamSet = job.teamOverrideHours != null;
    const overdue = isPendingJob(job) && due < new Date();
    const client = clientNameFor(data, job.clientId);
    const canAssign = canAny(data, ['jobs.assign', 'jobs.reassign']);
    const canChangeStatus = canAny(data, ['jobs.edit', 'jobs.update_status']);
    const canOverrideTat = can(data, 'jobs.override_tat');
    const save = async () => {
        const patch = {};
        if (canChangeStatus)
            patch.status = status;
        if (canOverrideTat) {
            patch.teamOverrideHours = Number(hours);
            patch.teamOverrideNote = note;
        }
        if (canAssign) {
            patch.assignedToUserId = assignee;
            patch.departmentId = department;
            patch.assignmentNote = assignmentNote;
        }
        await api.updateJob(job.id, patch);
        await reload?.();
    };
    return _jsxs("article", { className: `job priority-${job.priority} ${completed ? 'completed' : ''}`, children: [
            _jsxs("div", { className: "job-head", children: [
                    _jsxs("div", { children: [_jsx("h3", { children: job.title }), _jsxs("p", { children: ["Posted by ", _jsx("b", { children: job.postedBy }), " on ", fmt(job.datePosted)] })] }),
                    _jsxs("div", { className: "badges", children: [
                            can(data, 'jobs.view_all') && _jsx("span", { className: "badge client", children: client }),
                            job.assignedToName && _jsx("span", { className: "badge team", children: job.assignedToName }),
                            job.departmentName && _jsx("span", { className: "badge category", children: job.departmentName }),
                            _jsx("span", { className: "badge category", children: job.category }),
                            _jsx("span", { className: `badge ${job.priority}`, children: job.priority }),
                            teamSet && _jsx("span", { className: "badge team", children: "Team-set TAT" }),
                            _jsx("span", { className: "badge status", children: statusLabels[job.status] })
                        ] })
                ] }),
            job.description && _jsx("p", { className: "description", children: job.description }),
            job.assetLink && _jsx("a", { href: job.assetLink, target: "_blank", rel: "noreferrer", children: "View assets \u2197" }),
            completed ? _jsxs("p", { className: "due", children: ["Completed on ", _jsx("b", { children: fmt(dateForMonth(job)) })] }) : _jsxs("p", { className: "due", children: [teamSet ? "Team TAT: " : "System TAT: ", _jsxs("b", { children: [effectiveHours, " hrs"] }), " - due by ", _jsx("b", { children: fmt(due) }), overdue && _jsx("span", { className: "overdue", children: " (overdue)" })] }),
            job.teamOverrideNote && _jsxs("div", { className: "team-note", children: ["Team note: ", job.teamOverrideNote] }),
            job.assignmentNote && _jsxs("div", { className: "team-note", children: ["Assignment note: ", job.assignmentNote] }),
            editable && canAny(data, ['jobs.edit', 'jobs.update_status', 'jobs.override_tat', 'jobs.assign', 'jobs.reassign']) && _jsxs("div", { className: "editbar job-editbar", children: [
                    canChangeStatus && _jsx("select", { value: status, onChange: e => setStatus(e.target.value), children: Object.entries(statusLabels).map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }),
                    canOverrideTat && _jsx("input", { type: "number", min: "1", value: hours, onChange: e => setHours(Number(e.target.value)), "aria-label": "TAT hours" }),
                    canOverrideTat && _jsx("input", { value: note, onChange: e => setNote(e.target.value), placeholder: "Team TAT note" }),
                    canAssign && _jsxs("select", { value: assignee, onChange: e => setAssignee(e.target.value), "aria-label": "Assigned employee", children: [_jsx("option", { value: "", children: "Unassigned" }), (data.assignees || []).map(user => _jsx("option", { value: user.id, children: user.departmentName ? `${user.name} - ${user.departmentName}` : user.name }, user.id))] }),
                    canAssign && _jsxs("select", { value: department, onChange: e => setDepartment(e.target.value), "aria-label": "Job department", children: [_jsx("option", { value: "", children: "No department" }), (data.departments || []).map(item => _jsx("option", { value: item.id, children: item.name }, item.id))] }),
                    canAssign && _jsx("input", { value: assignmentNote, onChange: e => setAssignmentNote(e.target.value), placeholder: "Assignment note" }),
                    _jsx("button", { onClick: save, children: "Save" })
                ] })
        ] });
}
function SettingsPanel({ initial, reload }) { const [s, setS] = useState(initial); const save = async () => { await api.saveSettings(s); await reload(); alert('TAT standards saved.'); }; return _jsxs("section", { className: "card", children: [_jsx("h2", { children: "TAT standards" }), s.categories.map((c, i) => _jsxs("div", { className: "setting-row", children: [_jsx("input", { value: c.name, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, name: e.target.value } : x) }) }), _jsx("input", { type: "number", min: "1", value: c.baseHours, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, baseHours: Number(e.target.value) } : x) }) }), _jsx("button", { onClick: () => setS({ ...s, categories: s.categories.filter((_, n) => n !== i) }), children: "Remove" })] }, i)), _jsx("button", { onClick: () => setS({ ...s, categories: [...s.categories, { name: 'New category', baseHours: 24 }] }), children: "+ Add category" }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category capacity", _jsx("input", { type: "number", value: s.capacityPerCategory, onChange: e => setS({ ...s, capacityPerCategory: Number(e.target.value) }) })] }), _jsxs("label", { children: ["Extra hours over capacity", _jsx("input", { type: "number", value: s.bufferHoursPerExtraJob, onChange: e => setS({ ...s, bufferHoursPerExtraJob: Number(e.target.value) }) })] })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Start hour", _jsx("input", { type: "number", step: "0.5", value: s.startHour, onChange: e => setS({ ...s, startHour: Number(e.target.value) }) })] }), _jsxs("label", { children: ["End hour", _jsx("input", { type: "number", step: "0.5", value: s.endHour, onChange: e => setS({ ...s, endHour: Number(e.target.value) }) })] })] }), _jsx("button", { className: "primary", onClick: save, children: "Save standards" })] }); }
function Clients({ data, reload }) {
    const [form, setForm] = useState({ id: '', name: '', password: '' });
    const [passwords, setPasswords] = useState({});
    const [message, setMessage] = useState('');
    const create = async () => {
        try {
            await api.createClient(form);
            setForm({ id: '', name: '', password: '' });
            setMessage('Client added.');
            await reload();
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    const update = async (id, patch) => {
        await api.updateClient(id, patch);
        await reload();
    };
    const resetPassword = async (id) => {
        const password = (passwords[id] || '').trim();
        if (password.length < 6) {
            setMessage('Enter a new password with at least 6 characters.');
            return;
        }
        try {
            await update(id, { password });
            setPasswords(current => ({ ...current, [id]: '' }));
            setMessage('Password reset successfully.');
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    const toggleClient = async (id, status) => {
        const next = status === 'active' ? 'archived' : 'active';
        try {
            await update(id, { status: next });
            setMessage(next === 'archived' ? 'Client archived.' : 'Client restored.');
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    const deleteClient = async (client) => {
        if (!window.confirm(`Permanently delete ${client.name}? This cannot be undone.`))
            return;
        try {
            await api.deleteClient(client.id);
            setPasswords(current => {
                const next = { ...current };
                delete next[client.id];
                return next;
            });
            setMessage('Client deleted.');
            await reload();
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    return (
        <section className="card">
            <h2>Manage clients</h2>
            <p className="muted">Each client logs in with their own ID and password, and only sees their own jobs.</p>
            {message && <div className="alert">{message}</div>}
            <div className="client-table-wrap">
                <table className="client-table">
                    <thead>
                        <tr>
                            <th>Client ID</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>New Password</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.clients.map(client => (
                            <tr key={client.id}>
                                <td data-label="Client ID"><b>{client.id}</b></td>
                                <td data-label="Name">{client.name}</td>
                                <td data-label="Status"><span className={`status-pill ${client.status}`}>{client.status}</span></td>
                                <td data-label="New Password">
                                    <input
                                        type="password"
                                        value={passwords[client.id] || ''}
                                        onChange={event => setPasswords(current => ({ ...current, [client.id]: event.target.value }))}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter')
                                                resetPassword(client.id);
                                        }}
                                        placeholder="minimum 6 characters"
                                        aria-label={`New password for ${client.name}`}
                                    />
                                </td>
                                <td data-label="Actions">
                                    <div className="client-actions">
                                        <button type="button" className="primary small" onClick={() => resetPassword(client.id)}>Reset Password</button>
                                        <button type="button" className={client.status === 'active' ? 'danger small' : 'small'} onClick={() => toggleClient(client.id, client.status)}>
                                            {client.status === 'active' ? 'Archive' : 'Restore'}
                                        </button>
                                        <button type="button" className="danger small" onClick={() => deleteClient(client)}>Delete</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <h3>Add client</h3>
            <div className="row">
                <label>Client ID
                    <input value={form.id} onChange={event => setForm({ ...form, id: event.target.value.toLowerCase() })} />
                </label>
                <label>Name
                    <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
                </label>
                <label>Temporary password
                    <input value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
                </label>
            </div>
            <button type="button" className="primary" onClick={create}>+ Add client</button>
        </section>
    );
}

function ManagementTable({ columns, rows, empty }) {
    if (!rows.length)
        return <div className="dashboard-empty management-empty"><b>{empty}</b></div>;
    return (
        <div className="responsive-table management-table-wrap">
            <table className="management-table">
                <thead>
                    <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.id}>
                            {columns.map(column => (
                                <td data-label={column.label} key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Employees({ data }) {
    const [users, setUsers] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        setLoading(true);
        api.users()
            .then(result => {
                if (!active) return;
                setUsers(result.users || []);
                setError('');
            })
            .catch(err => active && setError(err.message))
            .finally(() => active && setLoading(false));
        return () => { active = false; };
    }, []);
    const employees = users.filter(user => user.accountType !== 'client');
    const activeEmployees = employees.filter(user => user.status === 'active').length;
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>Employee Management</span>
                    <h2>Employees</h2>
                    <p>Internal users, reporting-ready roles, and access status.</p>
                </div>
            </div>
            {error && <div className="alert error">{error}</div>}
            <div className="management-stats">
                <DashboardStat tone="blue" icon="users" value={employees.length} label="Internal Users" support="Admins and employees" />
                <DashboardStat tone="green" icon="completed" value={activeEmployees} label="Active" support="Currently enabled" />
                <DashboardStat tone="purple" icon="clock" value={employees.filter(user => user.lastLogin).length} label="Logged In" support="Have login history" />
            </div>
            <article className="dashboard-card management-card">
                <div className="dashboard-card-head">
                    <div>
                        <h3>Team Directory</h3>
                        <p>{loading ? 'Loading internal users...' : 'Live users from the workspace database.'}</p>
                    </div>
                </div>
                <ManagementTable
                    empty="No employees found."
                    rows={employees}
                    columns={[
                        { key: 'name', label: 'Name', render: user => <b>{user.name}</b> },
                        { key: 'id', label: 'User ID' },
                        { key: 'accountType', label: 'Type', render: user => <span className={`status-pill ${user.accountType}`}>{user.accountType}</span> },
                        { key: 'roleName', label: 'Role' },
                        { key: 'departmentName', label: 'Department', render: user => user.departmentName || '-' },
                        { key: 'designationName', label: 'Designation', render: user => user.designationName || '-' },
                        { key: 'status', label: 'Status', render: user => <span className={`status-pill ${user.status}`}>{user.status}</span> },
                        { key: 'lastLogin', label: 'Last Login', render: user => user.lastLogin ? shortDateTime(user.lastLogin) : '-' }
                    ]}
                />
            </article>
        </section>
    );
}

const summarizeAuditDetails = details => {
    const entries = Object.entries(details || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!entries.length)
        return '-';
    return entries.slice(0, 4).map(([key, value]) => {
        const text = Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : String(value);
        return `${key}: ${text.length > 80 ? `${text.slice(0, 77)}...` : text}`;
    }).join(' | ');
};

function AuditLogs() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        api.auditLogs()
            .then(result => { if (active) setLogs(result.logs || []); })
            .catch(err => { if (active) setError(err.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>Security</span>
                    <h2>Audit Logs</h2>
                    <p>Recent administrative and workflow events recorded by the system.</p>
                </div>
            </div>
            {error && <div className="alert error">{error}</div>}
            <article className="dashboard-card management-card">
                <div className="dashboard-card-head">
                    <div>
                        <h3>Recent Activity</h3>
                        <p>{loading ? 'Loading audit history...' : `${logs.length} recent event${logs.length === 1 ? '' : 's'}.`}</p>
                    </div>
                </div>
                <ManagementTable
                    empty="No audit logs found."
                    rows={logs}
                    columns={[
                        { key: 'createdAt', label: 'Time', render: log => shortDateTime(log.createdAt) },
                        { key: 'actorId', label: 'Actor' },
                        { key: 'action', label: 'Action', render: log => <span className="status-pill active">{log.action}</span> },
                        { key: 'entityType', label: 'Entity' },
                        { key: 'entityId', label: 'Entity ID' },
                        { key: 'details', label: 'Details', render: log => summarizeAuditDetails(log.details) }
                    ]}
                />
            </article>
        </section>
    );
}

function UsersRoles({ data, reload }) {
    const [activePanel, setActivePanel] = useState('users');
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [designations, setDesignations] = useState([]);
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [draftPermissions, setDraftPermissions] = useState([]);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState({ id: '', name: '', email: '', phone: '', password: '', accountType: 'employee', roleId: '', clientId: '', employeeId: '', joiningDate: '', departmentId: '', designationId: '', managerUserId: '' });
    const [roleForm, setRoleForm] = useState({ name: '', description: '', roleType: 'internal', level: 40 });
    const loadManagement = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [usersResult, rolesResult, permissionsResult, departmentsResult, designationsResult] = await Promise.all([
                can(data, 'users.view') ? api.users() : Promise.resolve({ users: [] }),
                can(data, 'roles.view') ? api.roles() : Promise.resolve({ roles: [] }),
                canAny(data, ['roles.view', 'roles.manage_permissions']) ? api.permissions() : Promise.resolve({ permissions: [] }),
                canAny(data, ['departments.manage', 'users.view', 'employees.view']) ? api.departments() : Promise.resolve({ departments: [] }),
                canAny(data, ['designations.manage', 'users.view', 'employees.view']) ? api.designations() : Promise.resolve({ designations: [] })
            ]);
            setUsers(usersResult.users || []);
            setRoles(rolesResult.roles || []);
            setPermissions(permissionsResult.permissions || []);
            setDepartments(departmentsResult.departments || []);
            setDesignations(designationsResult.designations || []);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    }, [data]);
    useEffect(() => { loadManagement(); }, [loadManagement]);
    useEffect(() => {
        if (selectedRoleId || !roles.length) return;
        setSelectedRoleId(roles[0].id);
    }, [roles, selectedRoleId]);
    const selectedRole = roles.find(role => role.id === selectedRoleId);
    useEffect(() => {
        setDraftPermissions(selectedRole?.permissions || []);
    }, [selectedRoleId, selectedRole]);
    const canManageSuperAdmin = data.user.accountType === 'super_admin' || data.user.roleSlug === 'super_admin';
    const roleOptions = useMemo(() => roles.filter(role => {
        const typeMatches = form.accountType === 'client' ? role.roleType === 'client' : role.roleType !== 'client';
        if (!typeMatches)
            return false;
        if (!canManageSuperAdmin && Number(role.level || 0) >= 80)
            return false;
        return role.id !== 'super_admin' || (canManageSuperAdmin && form.accountType === 'super_admin');
    }), [roles, form.accountType, canManageSuperAdmin]);
    const internalUsers = useMemo(() => users.filter(user => user.accountType !== 'client'), [users]);
    const canEditUsers = canAny(data, ['users.edit', 'employees.edit']);
    const canEditRoles = can(data, 'roles.edit');
    const managementTabs = useMemo(() => [
        can(data, 'users.view') && ['users', 'Users'],
        can(data, 'roles.view') && ['roles', 'Roles'],
        can(data, 'roles.manage_permissions') && ['permissions', 'Permissions'],
        can(data, 'departments.manage') && ['departments', 'Departments'],
        can(data, 'designations.manage') && ['designations', 'Designations'],
        can(data, 'users.view') && ['hierarchy', 'Hierarchy']
    ].filter(Boolean), [data]);
    useEffect(() => {
        if (managementTabs.length && !managementTabs.some(([id]) => id === activePanel))
            setActivePanel(managementTabs[0][0]);
    }, [activePanel, managementTabs]);
    useEffect(() => {
        if (roleOptions.some(role => role.id === form.roleId)) return;
        setForm(current => ({ ...current, roleId: roleOptions[0]?.id || '' }));
    }, [form.accountType, form.roleId, roleOptions]);
    const permissionGroups = useMemo(() => permissions.reduce((groups, permission) => {
        groups[permission.module] = [...(groups[permission.module] || []), permission];
        return groups;
    }, {}), [permissions]);
    const togglePermission = permissionId => {
        setDraftPermissions(current => current.includes(permissionId)
            ? current.filter(item => item !== permissionId)
            : [...current, permissionId]);
    };
    const saveRolePermissions = async () => {
        if (!selectedRole)
            return;
        try {
            await api.updateRolePermissions(selectedRole.id, draftPermissions);
            setMessage('Role permissions saved.');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const createUser = async event => {
        event.preventDefault();
        try {
            await api.createUser(form);
            setMessage('User created successfully.');
            setForm({ id: '', name: '', email: '', phone: '', password: '', accountType: 'employee', roleId: roleOptions[0]?.id || '', clientId: '', employeeId: '', joiningDate: '', departmentId: '', designationId: '', managerUserId: '' });
            setActivePanel('users');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const createRole = async event => {
        event.preventDefault();
        setMessage('');
        setError('');
        try {
            await api.createRole({ ...roleForm, level: Number(roleForm.level), permissions: [] });
            setRoleForm({ name: '', description: '', roleType: 'internal', level: 40 });
            setMessage('Role created. Select it below to configure permissions.');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const updateRole = async (role, patch) => {
        try {
            await api.updateRole(role.id, patch);
            setMessage('Role updated.');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const updateUser = async (user, patch) => {
        try {
            await api.updateUser(user.id, patch);
            setMessage('User updated.');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setError(err.message);
        }
    };
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>Access Control</span>
                    <h2>Users & Roles</h2>
                    <p>Database-backed roles, permissions, and account access.</p>
                </div>
            </div>
            {message && <div className="alert success">{message}</div>}
            {error && <div className="alert error">{error}</div>}
            <div className="management-tabs" role="tablist" aria-label="Users and roles sections">
                {managementTabs.map(([id, label]) => (
                    <button type="button" className={activePanel === id ? 'active' : ''} onClick={() => setActivePanel(id)} key={id}>{label}</button>
                ))}
            </div>
            {activePanel === 'users' && (
                <>
                    {can(data, 'users.create') && (
                        <article className="dashboard-card management-card">
                            <div className="dashboard-card-head">
                                <div>
                                    <h3>Add User</h3>
                                    <p>Create Admin, Employee, or Client accounts with a protected role.</p>
                                </div>
                            </div>
                            <form className="management-form" onSubmit={createUser}>
                                <div className="row">
                                    <label>User ID<input required value={form.id} onChange={event => setForm({ ...form, id: event.target.value })} /></label>
                                    <label>Full Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                                </div>
                                <div className="row">
                                    <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
                                    <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
                                </div>
                                <div className="row">
                                    <label>Account Type
                                        <select value={form.accountType} onChange={event => setForm({ ...form, accountType: event.target.value, clientId: '', departmentId: '', designationId: '', managerUserId: '' })}>
                                            <option value="employee">Employee</option>
                                            {canManageSuperAdmin && <option value="admin">Admin</option>}
                                            <option value="client">Client</option>
                                            {canManageSuperAdmin && <option value="super_admin">Super Admin</option>}
                                        </select>
                                    </label>
                                    <label>Role
                                        <select required value={form.roleId} onChange={event => setForm({ ...form, roleId: event.target.value })}>
                                            {roleOptions.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
                                        </select>
                                    </label>
                                </div>
                                {form.accountType === 'client' ? (
                                    <label>Client Organization
                                        <select required value={form.clientId} onChange={event => setForm({ ...form, clientId: event.target.value })}>
                                            <option value="">Select client</option>
                                            {data.clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}
                                        </select>
                                    </label>
                                ) : (
                                    <>
                                        <div className="row">
                                            <label>Department
                                                <select value={form.departmentId} onChange={event => setForm({ ...form, departmentId: event.target.value })}>
                                                    <option value="">No department</option>
                                                    {departments.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                                                </select>
                                            </label>
                                            <label>Designation
                                                <select value={form.designationId} onChange={event => setForm({ ...form, designationId: event.target.value })}>
                                                    <option value="">No designation</option>
                                                    {designations.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                                                </select>
                                            </label>
                                        </div>
                                        <div className="row">
                                            <label>Reporting Manager
                                                <select value={form.managerUserId} onChange={event => setForm({ ...form, managerUserId: event.target.value })}>
                                                    <option value="">No manager</option>
                                                    {internalUsers.map(user => <option value={user.id} key={user.id}>{user.name}</option>)}
                                                </select>
                                            </label>
                                            <label>Employee ID<input value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })} /></label>
                                            <label>Joining Date<input type="date" value={form.joiningDate} onChange={event => setForm({ ...form, joiningDate: event.target.value })} /></label>
                                        </div>
                                    </>
                                )}
                                <label>Temporary Password<input required type="password" minLength={8} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
                                <button className="primary">Create User</button>
                            </form>
                        </article>
                    )}
                    <article className="dashboard-card management-card">
                        <div className="dashboard-card-head">
                            <div>
                                <h3>Users</h3>
                                <p>{loading ? 'Loading users...' : `${users.length} account${users.length === 1 ? '' : 's'} in the workspace.`}</p>
                            </div>
                        </div>
                        <ManagementTable
                            empty="No users found."
                            rows={users}
                            columns={[
                                { key: 'name', label: 'Name', render: user => <b>{user.name}</b> },
                                { key: 'id', label: 'User ID' },
                                { key: 'email', label: 'Email', render: user => user.email || '-' },
                                { key: 'accountType', label: 'Type', render: user => <span className={`status-pill ${user.accountType}`}>{user.accountType}</span> },
                                { key: 'roleName', label: 'Role', render: user => can(data, 'users.assign_role') && user.accountType !== 'client' && user.id !== data.user.id ? <select value={user.roleId || ''} onChange={event => updateUser(user, { roleId: event.target.value })}>{roles.filter(role => role.roleType !== 'client' && (canManageSuperAdmin || Number(role.level || 0) < 80) && (user.accountType === 'super_admin' ? role.id === 'super_admin' : role.id !== 'super_admin')).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select> : user.roleName },
                                { key: 'departmentName', label: 'Department', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.departmentId || ''} onChange={event => updateUser(user, { departmentId: event.target.value })}><option value="">None</option>{departments.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : user.departmentName || '-' },
                                { key: 'designationName', label: 'Designation', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.designationId || ''} onChange={event => updateUser(user, { designationId: event.target.value })}><option value="">None</option>{designations.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : user.designationName || '-' },
                                { key: 'managerName', label: 'Manager', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.managerUserId || ''} onChange={event => updateUser(user, { managerUserId: event.target.value })}><option value="">None</option>{internalUsers.filter(manager => manager.id !== user.id).map(manager => <option value={manager.id} key={manager.id}>{manager.name}</option>)}</select> : user.managerName || '-' },
                                { key: 'status', label: 'Status', render: user => canEditUsers ? <select value={user.status} onChange={event => updateUser(user, { status: event.target.value })}><option value="active">active</option><option value="archived">archived</option></select> : <span className={`status-pill ${user.status}`}>{user.status}</span> }
                            ]}
                        />
                    </article>
                </>
            )}
            {activePanel === 'roles' && (
                <article className="dashboard-card management-card">
                    <div className="dashboard-card-head">
                        <div>
                            <h3>Role Permissions</h3>
                            <p>{loading ? 'Loading permission catalog...' : 'Select a role and control module access.'}</p>
                        </div>
                    </div>
                    {can(data, 'roles.create') && (
                        <form className="management-form compact" onSubmit={createRole}>
                            <div className="row">
                                <label>Role Name<input required value={roleForm.name} onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} /></label>
                                <label>Role Type
                                    <select value={roleForm.roleType} onChange={event => setRoleForm({ ...roleForm, roleType: event.target.value })}>
                                        <option value="internal">Internal</option>
                                        <option value="client">Client</option>
                                    </select>
                                </label>
                                <label>Level<input type="number" min="0" max={canManageSuperAdmin ? "100" : "79"} value={roleForm.level} onChange={event => setRoleForm({ ...roleForm, level: event.target.value })} /></label>
                            </div>
                            <label>Description<input value={roleForm.description} onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} /></label>
                            <button className="primary">Create Role</button>
                        </form>
                    )}
                    {roles.length ? (
                        <>
                            <ManagementTable
                                empty="No roles available."
                                rows={roles}
                                columns={[
                                    { key: 'name', label: 'Role', render: role => canEditRoles && role.id !== 'super_admin' ? <input defaultValue={role.name} onBlur={event => event.target.value.trim() && event.target.value.trim() !== role.name && updateRole(role, { name: event.target.value.trim() })} /> : <b>{role.name}</b> },
                                    { key: 'description', label: 'Description', render: role => canEditRoles && role.id !== 'super_admin' ? <input defaultValue={role.description || ''} onBlur={event => event.target.value !== (role.description || '') && updateRole(role, { description: event.target.value })} /> : role.description || '-' },
                                    { key: 'roleType', label: 'Type', render: role => canEditRoles && !role.isSystem ? <select value={role.roleType} onChange={event => updateRole(role, { roleType: event.target.value })}><option value="internal">internal</option><option value="client">client</option></select> : <span className={`status-pill ${role.roleType}`}>{role.roleType}</span> },
                                    { key: 'level', label: 'Level', render: role => canEditRoles && role.id !== 'super_admin' ? <input type="number" min="0" max="100" defaultValue={role.level} onBlur={event => Number(event.target.value) !== Number(role.level) && updateRole(role, { level: Number(event.target.value) })} /> : role.level },
                                    { key: 'status', label: 'Status', render: role => canEditRoles && !role.isSystem ? <select value={role.status} onChange={event => updateRole(role, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> : <span className={`status-pill ${role.status}`}>{role.status}</span> }
                                ]}
                            />
                            <label className="management-select">Role
                                <select value={selectedRoleId} onChange={event => setSelectedRoleId(event.target.value)}>
                                    {roles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
                                </select>
                            </label>
                            <div className="permission-groups">
                                {Object.entries(permissionGroups).map(([module, items]) => (
                                    <section className="permission-group" key={module}>
                                        <h4>{module.replace(/_/g, ' ')}</h4>
                                        <div>
                                            {items.map(permission => (
                                                <label className="permission-check" key={permission.id}>
                                                    <input
                                                        type="checkbox"
                                                        checked={draftPermissions.includes(permission.id)}
                                                        onChange={() => togglePermission(permission.id)}
                                                        disabled={!can(data, 'roles.manage_permissions') || selectedRole?.id === 'super_admin'}
                                                    />
                                                    <span>{permission.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </section>
                                ))}
                            </div>
                            {selectedRole?.id === 'super_admin' && <p className="field-note">Super Admin permissions are protected and always include every permission.</p>}
                            <button type="button" className="primary" onClick={saveRolePermissions} disabled={!can(data, 'roles.manage_permissions') || selectedRole?.id === 'super_admin'}>Save Role Permissions</button>
                        </>
                    ) : <DashboardEmptyState title="No roles available." body="Roles will appear here after the RBAC catalog is seeded." />}
                </article>
            )}
            {activePanel === 'permissions' && <UserPermissionsPanel users={users} permissions={permissions} currentUser={data.user} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'departments' && <DepartmentsPanel departments={departments} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'designations' && <DesignationsPanel designations={designations} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'hierarchy' && <HierarchyPanel users={internalUsers} />}
        </section>
    );
}

function UserPermissionsPanel({ users, permissions, currentUser, reloadManagement, setMessage, setError }) {
    const editableUsers = useMemo(() => users.filter(user => user.accountType !== 'super_admin'), [users]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [overrideMap, setOverrideMap] = useState({});
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (selectedUserId || !editableUsers.length)
            return;
        const first = editableUsers.find(user => user.id !== currentUser.id) || editableUsers[0];
        setSelectedUserId(first?.id || '');
    }, [editableUsers, selectedUserId, currentUser.id]);
    useEffect(() => {
        if (!selectedUserId)
            return;
        let active = true;
        setLoading(true);
        api.userPermissionOverrides(selectedUserId)
            .then(result => {
                if (!active)
                    return;
                setOverrideMap((result.overrides || []).reduce((map, override) => ({ ...map, [override.permissionId]: override.effect }), {}));
            })
            .catch(err => active && setError(err.message))
            .finally(() => active && setLoading(false));
        return () => { active = false; };
    }, [selectedUserId, setError]);
    const selectedUser = users.find(user => user.id === selectedUserId);
    const permissionGroups = useMemo(() => permissions.reduce((groups, permission) => {
        groups[permission.module] = [...(groups[permission.module] || []), permission];
        return groups;
    }, {}), [permissions]);
    const setOverride = (permissionId, effect) => {
        setOverrideMap(current => {
            const next = { ...current };
            if (!effect)
                delete next[permissionId];
            else
                next[permissionId] = effect;
            return next;
        });
    };
    const save = async () => {
        if (!selectedUser || selectedUser.id === currentUser.id)
            return;
        const grants = Object.entries(overrideMap).filter(([, effect]) => effect === 'grant').map(([permissionId]) => permissionId);
        const revokes = Object.entries(overrideMap).filter(([, effect]) => effect === 'revoke').map(([permissionId]) => permissionId);
        try {
            await api.updateUserPermissionOverrides(selectedUser.id, { grants, revokes });
            setMessage('User permission overrides saved.');
            await reloadManagement();
        }
        catch (err) {
            setError(err.message);
        }
    };
    return (
        <article className="dashboard-card management-card">
            <div className="dashboard-card-head">
                <div>
                    <h3>User Permission Overrides</h3>
                    <p>Grant or revoke individual permissions without changing the user's role.</p>
                </div>
            </div>
            {editableUsers.length ? (
                <>
                    <label className="management-select">User
                        <select value={selectedUserId} onChange={event => setSelectedUserId(event.target.value)}>
                            {editableUsers.map(user => <option value={user.id} key={user.id}>{user.name} - {user.roleName || user.accountType}</option>)}
                        </select>
                    </label>
                    {selectedUser?.id === currentUser.id && <div className="alert error">You cannot change your own permission overrides.</div>}
                    {loading ? <div className="dashboard-empty management-empty"><b>Loading overrides...</b></div> : (
                        <div className="permission-groups override-groups">
                            {Object.entries(permissionGroups).map(([module, items]) => (
                                <section className="permission-group" key={module}>
                                    <h4>{module.replace(/_/g, ' ')}</h4>
                                    <div>
                                        {items.map(permission => (
                                            <label className="permission-check permission-override" key={permission.id}>
                                                <span>{permission.label}</span>
                                                <select value={overrideMap[permission.id] || ''} onChange={event => setOverride(permission.id, event.target.value)}>
                                                    <option value="">Inherit</option>
                                                    <option value="grant">Grant</option>
                                                    <option value="revoke">Revoke</option>
                                                </select>
                                            </label>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                    <button type="button" className="primary" onClick={save} disabled={!selectedUser || selectedUser.id === currentUser.id}>Save User Overrides</button>
                </>
            ) : <DashboardEmptyState title="No editable users." body="Create a non-Super Admin user before assigning individual overrides." />}
        </article>
    );
}

function DepartmentsPanel({ departments, reloadManagement, setMessage, setError }) {
    const [form, setForm] = useState({ name: '', code: '', description: '' });
    const create = async event => {
        event.preventDefault();
        try {
            await api.createDepartment(form);
            setForm({ name: '', code: '', description: '' });
            setMessage('Department created.');
            await reloadManagement();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const update = async (department, patch) => {
        try {
            await api.updateDepartment(department.id, patch);
            setMessage('Department updated.');
            await reloadManagement();
        }
        catch (err) {
            setError(err.message);
        }
    };
    return (
        <article className="dashboard-card management-card">
            <div className="dashboard-card-head">
                <div>
                    <h3>Departments</h3>
                    <p>Create and manage internal departments used by employees and assignments.</p>
                </div>
            </div>
            <form className="management-form compact" onSubmit={create}>
                <div className="row">
                    <label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                    <label>Code<input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} placeholder="Auto if blank" /></label>
                    <label>Description<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
                </div>
                <button className="primary">Add Department</button>
            </form>
            <ManagementTable
                empty="No departments found."
                rows={departments}
                columns={[
                    { key: 'name', label: 'Name', render: item => <b>{item.name}</b> },
                    { key: 'code', label: 'Code' },
                    { key: 'description', label: 'Description', render: item => item.description || '-' },
                    { key: 'status', label: 'Status', render: item => <select value={item.status} onChange={event => update(item, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> },
                    { key: 'updatedAt', label: 'Updated', render: item => item.updatedAt ? shortDateTime(item.updatedAt) : '-' }
                ]}
            />
        </article>
    );
}

function DesignationsPanel({ designations, reloadManagement, setMessage, setError }) {
    const [form, setForm] = useState({ name: '', code: '', description: '', hierarchyLevel: 10 });
    const create = async event => {
        event.preventDefault();
        try {
            await api.createDesignation({ ...form, hierarchyLevel: Number(form.hierarchyLevel) });
            setForm({ name: '', code: '', description: '', hierarchyLevel: 10 });
            setMessage('Designation created.');
            await reloadManagement();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const update = async (designation, patch) => {
        try {
            await api.updateDesignation(designation.id, patch);
            setMessage('Designation updated.');
            await reloadManagement();
        }
        catch (err) {
            setError(err.message);
        }
    };
    return (
        <article className="dashboard-card management-card">
            <div className="dashboard-card-head">
                <div>
                    <h3>Designations</h3>
                    <p>Configure organization levels without hard-coding your company structure.</p>
                </div>
            </div>
            <form className="management-form compact" onSubmit={create}>
                <div className="row">
                    <label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                    <label>Code<input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} placeholder="Auto if blank" /></label>
                    <label>Hierarchy Level<input type="number" min="0" max="999" value={form.hierarchyLevel} onChange={event => setForm({ ...form, hierarchyLevel: event.target.value })} /></label>
                </div>
                <label>Description<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
                <button className="primary">Add Designation</button>
            </form>
            <ManagementTable
                empty="No designations found."
                rows={designations}
                columns={[
                    { key: 'name', label: 'Name', render: item => <b>{item.name}</b> },
                    { key: 'code', label: 'Code' },
                    { key: 'hierarchyLevel', label: 'Level', render: item => <input type="number" min="0" max="999" value={item.hierarchyLevel} onChange={event => update(item, { hierarchyLevel: Number(event.target.value) })} /> },
                    { key: 'description', label: 'Description', render: item => item.description || '-' },
                    { key: 'status', label: 'Status', render: item => <select value={item.status} onChange={event => update(item, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> }
                ]}
            />
        </article>
    );
}

function HierarchyPanel({ users }) {
    const byManager = useMemo(() => users.reduce((groups, user) => {
        const key = user.managerUserId || 'root';
        groups[key] = [...(groups[key] || []), user];
        return groups;
    }, {}), [users]);
    const roots = byManager.root || [];
    const renderNode = (user, depth = 0) => (
        <div className="hierarchy-node" style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }} key={user.id}>
            <div>
                <b>{user.name}</b>
                <span>{user.designationName || user.roleName || user.accountType}</span>
            </div>
            <small>{user.departmentName || 'No department'}</small>
            {(byManager[user.id] || []).map(child => renderNode(child, depth + 1))}
        </div>
    );
    return (
        <article className="dashboard-card management-card">
            <div className="dashboard-card-head">
                <div>
                    <h3>Hierarchy</h3>
                    <p>Reporting structure based on each user's manager assignment.</p>
                </div>
            </div>
            {roots.length ? <div className="hierarchy-tree">{roots.map(user => renderNode(user))}</div> : <DashboardEmptyState title="No hierarchy yet." body="Assign reporting managers to build the organization tree." />}
        </article>
    );
}
