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
const assigneeLabelFor = user => [user.name, user.designationName || user.roleName, user.departmentName].filter(Boolean).join(' - ');
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
    audit: 'Audit Logs',
    app_settings: 'Settings'
};
const fallbackModulesFor = data => data.user?.role === 'admin' || data.user?.accountType === 'admin' || data.user?.accountType === 'super_admin'
    ? [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'By Category'], ['settings', 'TAT Standards'], ['clients', 'Manage Clients'], ['employees', 'Employees'], ['users', 'Users & Roles'], ['support', 'Support Tickets'], ['audit', 'Audit Logs'], ['app_settings', 'Settings']]
    : [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'My Jobs'], ['support', 'Support Tickets']];
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
const loginPortalOptions = {
    admin: {
        label: 'Admin',
        storyTitle: 'Admin control center.',
        storyBody: 'Manage clients, users, departments, and delivery work from one secure console.',
        kicker: 'ADMIN CONSOLE',
        title: 'Admin Sign In',
        subtitle: 'Access client, employee, and role management.',
        foot: 'Users | Roles | Departments'
    },
    team: {
        label: 'Team',
        storyTitle: 'Team workdesk.',
        storyBody: 'Track assigned jobs, deadlines, support tickets, and delivery updates.',
        kicker: 'EMPLOYEE DESK',
        title: 'Team Sign In',
        subtitle: 'Open your assigned jobs and team workspace.',
        foot: 'Jobs | TAT | Support'
    },
    client: {
        label: 'Client',
        storyTitle: 'Client workspace.',
        storyBody: 'Submit jobs, upload asset links, and follow every request from one place.',
        kicker: 'CLIENT PORTAL',
        title: 'Client Sign In',
        subtitle: 'Submit work requests and check live status.',
        foot: 'Requests | Assets | Updates'
    }
};
const loginPortalFromPath = () => {
    const firstSegment = window.location.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (firstSegment === 'team')
        return { portal: 'team', locked: true };
    if (firstSegment === 'client' || firstSegment === 'clint')
        return { portal: 'client', locked: true };
    if (firstSegment === 'admin')
        return { portal: 'admin', locked: true };
    return { portal: 'admin', locked: false };
};
const dashboardRoleFor = user => {
    if (user?.accountType === 'super_admin' || user?.roleSlug === 'super_admin')
        return 'super_admin';
    if (user?.accountType === 'admin')
        return 'admin';
    if (user?.accountType === 'client')
        return 'client';
    return 'employee';
};
const dashboardProfileFor = data => {
    const roleKey = dashboardRoleFor(data.user);
    const profiles = {
        super_admin: {
            roleKey,
            workspaceTitle: 'Super Admin Console',
            overviewTitle: 'Super Admin Console',
            sidebarTitle: 'Platform Control',
            sidebarBody: 'Users, roles, departments, and audit tools.',
            sidebarButton: 'Open Users & Roles',
            sidebarTab: 'users'
        },
        admin: {
            roleKey,
            workspaceTitle: 'Admin Workspace',
            overviewTitle: 'Admin Dashboard',
            sidebarTitle: 'Team Management',
            sidebarBody: 'Create employees, departments, roles, and assignments.',
            sidebarButton: 'Manage Users',
            sidebarTab: 'users'
        },
        employee: {
            roleKey,
            workspaceTitle: 'Employee Desk',
            overviewTitle: 'Employee Dashboard',
            sidebarTitle: 'My Work',
            sidebarBody: 'Assigned jobs, due dates, and support updates.',
            sidebarButton: 'Open Jobs',
            sidebarTab: 'jobs'
        },
        client: {
            roleKey,
            workspaceTitle: 'Client Portal',
            overviewTitle: 'Client Dashboard',
            sidebarTitle: 'Need Help?',
            sidebarBody: 'Our support team is here to help you.',
            sidebarButton: 'Create Ticket',
            sidebarAction: 'support'
        }
    };
    return profiles[roleKey];
};
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
        return; load(); const socket = io(API_URL || undefined); socket.on('data:changed', load); socket.on('permissions:updated', load); return () => { socket.disconnect(); }; }, [auth, load]);
    if (!auth)
        return _jsx(Login, { onLogin: () => setAuth(true) });
    if (!data)
        return _jsx(LoadingScreen, { message: error || 'Preparing your dashboard...', hasError: Boolean(error) });
    const moduleTabs = (data.modules || [])
        .filter(module => knownDashboardTabs[module.id])
        .map(module => {
        if (module.id === 'jobs')
            return [module.id, can(data, 'jobs.view_all') ? 'By Category' : 'My Jobs'];
        if (module.id === 'clients')
            return [module.id, 'Manage Clients'];
        return [module.id, module.label || knownDashboardTabs[module.id]];
    });
    const tabs = Array.isArray(data.modules) ? moduleTabs : fallbackModulesFor(data);
    const activeTab = tabs.some(([id]) => id === tab) ? tab : (tabs[0]?.[0] || null);
    const logout = () => { setToken(null); setAuth(false); setData(null); };
    const openSupportTicketForm = () => {
        setSupportCreateSignal(value => value + 1);
        setTab('support');
    };
    const currentContent = !activeTab
        ? _jsxs("section", { className: "card access-denied", children: [_jsx("h2", { children: "No module access" }), _jsx("p", { children: "Your account is active, but no dashboard modules are currently assigned. Contact a Super Admin for access." })] })
        : activeTab === 'overview' && can(data, 'dashboard.view')
            ? _jsx(Overview, { data: data, setTab: setTab })
        : activeTab === 'submit' && can(data, 'jobs.create')
            ? _jsx(Submit, { data: data, reload: load })
            : activeTab === 'jobs' && canAny(data, ['jobs.view_all', 'jobs.view_own', 'jobs.view_department'])
                ? _jsx(Jobs, { data: data, reload: load })
                : activeTab === 'settings' && canAny(data, ['settings.view', 'settings.edit'])
                    ? _jsx(SettingsPanel, { initial: data.settings, reload: load })
                    : activeTab === 'clients' && canAny(data, ['clients.view_all', 'clients.view', 'clients.create'])
                        ? _jsx(Clients, { data: data, reload: load })
                        : activeTab === 'employees' && canAny(data, ['employees.view', 'employees.create', 'employees.edit'])
                            ? _jsx(Employees, { data: data, setTab: setTab })
                            : activeTab === 'users' && canAny(data, ['users.view', 'users.create', 'users.edit', 'users.assign_role', 'employees.view', 'employees.create', 'employees.edit', 'roles.view', 'roles.create', 'roles.edit', 'roles.manage_permissions', 'departments.manage', 'designations.manage', 'modules.view_access_rules', 'modules.manage_access'])
                                ? _jsx(UsersRoles, { data: data, reload: load })
                                : activeTab === 'support' && canAny(data, ['support.view_all', 'support.view_own', 'support.create'])
                                    ? _jsx(SupportTickets, { data: data, reload: load, openCreateSignal: supportCreateSignal })
                                    : activeTab === 'audit' && can(data, 'audit.view')
                                        ? _jsx(AuditLogs, {})
                                        : activeTab === 'app_settings' && canAny(data, ['settings.view', 'settings.edit'])
                                            ? _jsx(SystemSettings, { data: data })
                                            : _jsxs("section", { className: "card access-denied", children: [_jsx("h2", { children: "Access denied" }), _jsx("p", { children: "You do not have permission to open this module." })] });
    return _jsx(DashboardShell, { data: data, tabs: tabs, tab: activeTab, setTab: setTab, logout: logout, error: error, openSupportTicketForm: openSupportTicketForm, children: currentContent });
}
function Login({ onLogin }) {
    const [mode, setMode] = useState(initialAuthMode);
    const [portalRoute] = useState(loginPortalFromPath);
    const [portal] = useState(portalRoute.portal);
    const portalCopy = loginPortalOptions[portal];
    const showMode = next => {
        setMode(next);
        if (next === 'login')
            window.history.replaceState(null, '', window.location.pathname);
    };
    return _jsxs("div", { className: `auth-shell auth-${portal}`, children: [
            _jsxs("aside", { className: "auth-story", children: [
                    _jsx(AuthLogo, {}),
                    _jsxs("div", { className: "auth-story-copy", children: [_jsx("h1", { children: portalCopy.storyTitle }), _jsx("p", { children: portalCopy.storyBody })] }),
                    _jsx("div", { className: "auth-orbits", "aria-hidden": "true", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }),
                    _jsx("div", { className: "auth-story-foot", children: portalCopy.foot })
                ] }),
            _jsx("main", { className: "auth-panel", children: _jsxs("div", { className: "auth-card", children: [
                        _jsx("div", { className: "auth-mobile-logo", children: _jsx(AuthLogo, {}) }),
                        mode === 'login' && _jsx(LoginForm, { onLogin: onLogin, onMode: showMode, portal: portal }),
                        mode === 'forgot' && _jsx(ForgotPassword, { onMode: showMode }),
                        mode === 'reset' && _jsx(ResetPassword, { onMode: showMode }),
                        mode === 'signup' && _jsx(AdminSignup, { onMode: showMode })
                    ] }) })
        ] });
}
function AuthLogo() {
    return _jsx("div", { className: "auth-logo auth-logo-icon-only", children: _jsx("img", { src: ci360LogoMark, alt: "Workspace" }) });
}
function LoadingScreen({ message, hasError = false }) {
    return _jsxs("div", { className: `app-loading ${hasError ? 'has-error' : ''}`, role: "status", "aria-live": "polite", children: [
            _jsxs("div", { className: "app-loading-mark", children: [
                    _jsx("img", { src: ci360LogoMark, alt: "CI360" }),
                    _jsx("span", { "aria-hidden": "true" })
                ] }),
            _jsxs("div", { className: "app-loading-copy", children: [
                    _jsx("b", { children: hasError ? 'Workspace unavailable' : 'Loading workspace' }),
                    _jsx("small", { children: message })
                ] })
        ] });
}
function GoogleIcon() {
    return _jsxs("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: [_jsx("path", { fill: "#4285F4", d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" }), _jsx("path", { fill: "#34A853", d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" }), _jsx("path", { fill: "#FBBC05", d: "M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" }), _jsx("path", { fill: "#EA4335", d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" })] });
}
function LoginForm({ onLogin, onMode, portal }) {
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState('');
    const portalCopy = loginPortalOptions[portal];
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
            _jsx("div", { className: "auth-kicker", children: portalCopy.kicker }),
            _jsx("h2", { children: portalCopy.title }),
            _jsx("p", { className: "auth-subtitle", children: portalCopy.subtitle }),
            _jsxs("label", { children: ["Email or User ID", _jsx("input", { type: "text", value: id, onChange: e => setId(e.target.value), autoComplete: "username", placeholder: "name@company.com or workspace ID", required: true })] }),
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
            _jsx("p", { className: "auth-subtitle", children: "Password reset email is not enabled for this workspace yet. Contact your workspace administrator to reset access securely." }),
            _jsxs("label", { children: ["Email", _jsx("input", { type: "email", value: email, onChange: e => setEmail(e.target.value), autoComplete: "email", required: true })] }),
            sent && _jsxs("div", { className: "alert success", children: [_jsx("b", { children: "Request noted." }), _jsx("br", {}), "Ask a Super Admin to reset your account from Users & Roles."] }),
            _jsx("button", { className: "primary auth-primary", children: "Show Reset Instructions" }),
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
        setMessage('Secure reset links are not enabled yet. Ask a Super Admin to reset your password from Users & Roles.');
    };
    return _jsxs("form", { className: "auth-form", onSubmit: submit, children: [
            _jsx("div", { className: "auth-kicker", children: "SECURE RESET" }),
            _jsx("h2", { children: "Reset Password" }),
            _jsx("p", { className: "auth-subtitle", children: "Create a strong password for your workspace account." }),
            _jsxs("label", { children: ["New Password", _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), autoComplete: "new-password", required: true })] }),
            _jsxs("div", { className: "strength-meter", children: [_jsx("span", { style: { width: `${score * 20}%` } }), _jsx("small", { children: score >= 5 ? 'Strong password' : 'Password strength' })] }),
            _jsx("ul", { className: "password-rules", children: [['length', 'Minimum 8 characters'], ['upper', 'Uppercase'], ['lower', 'Lowercase'], ['number', 'Number'], ['special', 'Special character']].map(([key, label]) => _jsx("li", { className: checks[key] ? 'met' : '', children: label }, key)) }),
            _jsxs("label", { children: ["Confirm Password", _jsx("input", { type: "password", value: confirm, onChange: e => setConfirm(e.target.value), autoComplete: "new-password", required: true })] }),
            message && _jsx("div", { className: message.includes('Super Admin') ? 'alert success' : 'alert error', children: message }),
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
    return _jsxs("form", { className: "auth-form", onSubmit: e => { e.preventDefault(); setMessage('Admin signup is disabled here. Create Admin accounts from Users & Roles as a Super Admin.'); }, children: [
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
const dashboardTabIcons = { overview: 'overview', submit: 'submit', jobs: 'jobs', settings: 'clock', clients: 'users', employees: 'users', users: 'shield', support: 'support', audit: 'document', app_settings: 'settings' };
const dashboardTabDescriptions = {
    overview: 'Workspace summary',
    submit: 'Create a request',
    jobs: 'Browse every job',
    settings: 'Turnaround rules',
    clients: 'Client access',
    employees: 'Internal team',
    users: 'Roles and access',
    support: 'Help and tickets',
    audit: 'Activity history',
    app_settings: 'System controls'
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
        search: ['M21 21l-4.35-4.35', 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'],
        logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M21 3v18h-6'],
        calendar: ['M7 3v4', 'M17 3v4', 'M4 8h16', 'M5 5h14v16H5z'],
        plus: ['M12 5v14', 'M5 12h14'],
        arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
        total: ['M7 7h10', 'M7 12h10', 'M7 17h10', 'M4 4h16v16H4z'],
        pending: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v6l4 2'],
        completed: ['M20 6L9 17l-5-5', 'M21 12a9 9 0 1 1-3.2-6.9'],
        document: ['M7 3h7l5 5v13H7z', 'M14 3v6h5', 'M10 14h6', 'M10 18h4'],
        settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.64 8.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9c.18.6.74 1 1.36 1H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z'],
        shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-5'],
        moon: ['M21 14.4A8.6 8.6 0 0 1 9.6 3 7 7 0 1 0 21 14.4z'],
        sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M4.93 19.07l1.41-1.41', 'M17.66 6.34l1.41-1.41']
    };
    return _jsx("svg", { className: "dashboard-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (paths[name] || paths.overview).map((d, index) => _jsx("path", { d: d }, index)) });
}
function DashboardShell({ data, tabs, tab, setTab, logout, error, openSupportTicketForm, children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [notificationOpen, setNotificationOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
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
    const dashboardProfile = dashboardProfileFor(data);
    const isSuperAdminUser = dashboardProfile.roleKey === 'super_admin';
    const displayName = isSuperAdminUser ? 'Super Admin' : data.user.name;
    const avatarInitials = isSuperAdminUser ? 'SA' : initialsFor(displayName);
    const displayRole = isSuperAdminUser ? 'Super Admin' : (data.user.roleName || data.user.accountType || 'Workspace user');
    const goTo = id => {
        setTab(id);
        setSidebarOpen(false);
        setUserMenuOpen(false);
        setNotificationOpen(false);
        window.requestAnimationFrame(() => {
            document.querySelector('.dashboard-main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    };
    const submitSearch = event => {
        event.preventDefault();
        const term = searchTerm.trim();
        if (term) {
            try {
                sessionStorage.setItem('ci360-job-search', term);
                window.dispatchEvent(new Event('ci360-job-search'));
            }
            catch { }
            goTo('jobs');
        }
    };
    const runSidebarAction = () => {
        if (dashboardProfile.sidebarAction === 'support') {
            setSidebarOpen(false);
            setUserMenuOpen(false);
            setNotificationOpen(false);
            openSupportTicketForm();
            return;
        }
        goTo(dashboardProfile.sidebarTab || 'overview');
    };
    return _jsxs("main", { className: `dashboard-shell theme-${theme} role-${dashboardProfile.roleKey} ${sidebarOpen ? 'sidebar-open' : ''}`, children: [
            _jsx("button", { type: "button", className: "dashboard-backdrop", "aria-label": "Close navigation", onClick: () => setSidebarOpen(false) }),
            _jsxs("aside", { id: "dashboard-sidebar", className: "dashboard-sidebar", "aria-label": "Dashboard navigation", children: [
                    _jsx("div", { className: "dashboard-brand dashboard-brand-icon-only", children: _jsx("img", { src: ci360LogoMark, alt: "CI360degrees" }) }),
                    _jsx("div", { className: "dashboard-nav", role: "navigation", "aria-label": "Dashboard tabs", children: tabs.map(([id, label]) => _jsxs("button", { type: "button", className: tab === id ? 'active' : '', onClick: () => goTo(id), "aria-current": tab === id ? 'page' : undefined, children: [_jsx(DashboardIcon, { name: dashboardTabIcons[id] || 'overview' }), _jsxs("span", { children: [_jsx("b", { children: label }), _jsx("small", { children: dashboardTabDescriptions[id] || 'Open section' })] })] }, id)) }),
                    _jsxs("div", { className: "dashboard-sidebar-footer", children: [
                            _jsxs("div", { className: "dashboard-role-card", children: [_jsx(DashboardIcon, { name: dashboardProfile.sidebarAction === 'support' ? 'support' : 'shield' }), _jsx("b", { children: dashboardProfile.sidebarTitle }), _jsx("p", { children: dashboardProfile.sidebarBody }), _jsx("button", { type: "button", onClick: runSidebarAction, children: dashboardProfile.sidebarButton })] }),
                            _jsxs("div", { className: "dashboard-sidebar-profile", children: [_jsx("span", { className: "dashboard-avatar", children: avatarInitials }), _jsxs("div", { children: [_jsx("b", { children: displayName }), _jsx("small", { children: displayRole })] })] }),
                            _jsxs("button", { type: "button", className: "dashboard-sidebar-logout", onClick: logout, children: [_jsx(DashboardIcon, { name: "logout" }), _jsx("span", { children: "Logout" })] })
                        ] })
                ] }),
            _jsxs("section", { className: "dashboard-main", children: [
                    _jsxs("div", { className: "dashboard-topbar", children: [
                            _jsxs("div", { className: "dashboard-topbar-left", children: [_jsx("button", { type: "button", className: "dashboard-menu", "aria-label": sidebarOpen ? "Close navigation" : "Open navigation", "aria-controls": "dashboard-sidebar", "aria-expanded": sidebarOpen, onClick: () => setSidebarOpen(open => !open), children: _jsx(DashboardIcon, { name: "menu" }) }), _jsxs("div", { children: [_jsx("span", { children: activeLabel }), _jsx("strong", { children: dashboardProfile.workspaceTitle })] })] }),
                            _jsxs("form", { className: "dashboard-search", role: "search", onSubmit: submitSearch, children: [_jsx(DashboardIcon, { name: "search" }), _jsx("input", { type: "search", value: searchTerm, onChange: event => setSearchTerm(event.target.value), placeholder: "Search...", "aria-label": "Search jobs" }), _jsx("button", { type: "submit", "aria-label": "Open job search", children: _jsx(DashboardIcon, { name: "search" }) })] }),
                            _jsxs("div", { className: "dashboard-user-area", children: [
                                    _jsx("button", { type: "button", className: "dashboard-theme-toggle", "aria-label": theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', onClick: () => setTheme(current => current === 'dark' ? 'light' : 'dark'), children: _jsx(DashboardIcon, { name: theme === 'dark' ? 'sun' : 'moon' }) }),
                                    _jsxs("div", { className: "dashboard-notification-wrap", children: [_jsxs("button", { type: "button", className: "dashboard-notification", "aria-label": "Open latest activity", "aria-expanded": notificationOpen, onClick: () => { setNotificationOpen(open => !open); setUserMenuOpen(false); }, children: [_jsx(DashboardIcon, { name: "bell" }), notificationCount > 0 && _jsx("span", { children: notificationCount })] }), notificationOpen && _jsxs("div", { className: "dashboard-notification-menu", role: "dialog", "aria-label": "Latest activity", children: [_jsxs("div", { className: "dashboard-notification-head", children: [_jsx("b", { children: "Latest Activity" }), _jsxs("span", { children: [notificationCount, " open notice", notificationCount === 1 ? '' : 's'] })] }), activities.length ? _jsx("div", { className: "dashboard-activity-list compact", children: activities.map(item => _jsxs("button", { type: "button", className: `dashboard-activity ${item.tone}`, onClick: () => goTo(item.tab), children: [_jsx("span", { className: "dashboard-activity-dot" }), _jsxs("span", { children: [_jsx("b", { children: item.description }), _jsx("small", { children: shortDateTime(item.date) })] })] }, item.id)) }) : _jsx(DashboardEmptyState, { title: "No recent activity.", body: "Latest job, ticket, and client updates will appear here." }), _jsx("button", { type: "button", className: "dashboard-open-overview", onClick: () => goTo('overview'), children: "Open Dashboard" })] })] }),
                                    _jsxs("div", { className: "dashboard-user-menu-wrap", children: [_jsxs("button", { type: "button", className: "dashboard-user-button", "aria-expanded": userMenuOpen, onClick: () => { setUserMenuOpen(open => !open); setNotificationOpen(false); }, children: [_jsx("span", { className: "dashboard-avatar", children: avatarInitials }), _jsx("span", { children: displayName }), _jsx(DashboardIcon, { name: "chevron" })] }), userMenuOpen && _jsxs("div", { className: "dashboard-user-menu", role: "menu", children: [_jsxs("div", { children: [_jsx("b", { children: displayName }), _jsx("span", { children: displayRole })] }), _jsx("button", { type: "button", role: "menuitem", onClick: logout, children: "Log out" })] })] })
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
const relativeTime = value => {
    const time = timestamp(value);
    if (!time)
        return 'Date unavailable';
    const seconds = Math.max(1, Math.round((Date.now() - time) / 1000));
    if (seconds < 60)
        return 'Just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days < 8)
        return `${days} day${days === 1 ? '' : 's'} ago`;
    return shortDateTime(value);
};
function Overview({ data, setTab }) {
    const jobs = data.jobs || [];
    const tickets = data.supportTickets || [];
    const pendingJobs = [...jobs.filter(isPendingJob)].sort((a, b) => {
        const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
        return priorityDiff || timestamp(a.datePosted) - timestamp(b.datePosted);
    });
    const completedJobs = [...jobs.filter(isCompletedJob)].sort((a, b) => timestamp(dateForMonth(b)) - timestamp(dateForMonth(a)));
    const canOpenJobs = canAny(data, ['jobs.view_all', 'jobs.view_own', 'jobs.view_department']);
    const canOpenSupport = canAny(data, ['support.view_all', 'support.view_own', 'support.create']);
    const canOpenAudit = can(data, 'audit.view');
    const dashboardProfile = dashboardProfileFor(data);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const pendingWithDue = pendingJobs.map(job => ({ job, due: addWorkingHours(new Date(job.datePosted), job.teamOverrideHours ?? job.calculatedHours, data.settings) }));
    const validDue = due => !Number.isNaN(due.getTime());
    const dueTodayJobs = pendingWithDue.filter(({ due }) => validDue(due) && due >= todayStart && due <= todayEnd);
    const overdueJobs = pendingWithDue.filter(({ due }) => validDue(due) && due < now);
    const dueSoonJobs = pendingWithDue.filter(({ due }) => validDue(due)).sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 5);
    const openTickets = tickets.filter(ticket => !['Resolved', 'Closed'].includes(ticket.status)).length;
    const statusColors = ['#0d6efd', '#ff8a00', '#7047b8', '#14b8a6', '#64748b', '#ef233c', '#c6a336', '#a94335'];
    const statusRows = Object.entries(statusLabels).map(([key, label], index) => {
        const count = jobs.filter(job => job.status === key).length;
        return { key, label, count, color: statusColors[index % statusColors.length], percent: jobs.length ? count / jobs.length * 100 : 0 };
    }).filter(row => row.count > 0);
    let statusCursor = 0;
    const donutSegments = statusRows.map(row => {
        const start = statusCursor;
        const end = statusCursor + row.percent;
        statusCursor = end;
        return `${row.color} ${start}% ${end}%`;
    });
    const priorityColors = { Low: '#12b76a', Medium: '#0d6efd', High: '#ff8a00', Urgent: '#ef233c' };
    const priorityRows = ['Low', 'Medium', 'High', 'Urgent'].map(label => ({ label, count: jobs.filter(job => job.priority === label).length, color: priorityColors[label] }));
    const maxPriority = Math.max(1, ...priorityRows.map(row => row.count));
    const activeEmployees = (data.clientOwners || data.assignees || []).filter(user => user.accountType !== 'client').length;
    const activeClients = (data.clients || []).filter(client => client.status === 'active').length;
    const buildWorkloadRows = keyFor => {
        const grouped = pendingJobs.reduce((map, job) => {
            const key = keyFor(job) || 'Unassigned';
            const existing = map.get(key) || { label: key, count: 0, urgent: 0 };
            existing.count += 1;
            if (job.priority === 'Urgent')
                existing.urgent += 1;
            map.set(key, existing);
            return map;
        }, new Map());
        return [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 6);
    };
    const departmentWorkload = buildWorkloadRows(job => job.departmentName);
    const employeeWorkload = buildWorkloadRows(job => job.assignedToName);
    const metricCards = [
        ['blue', 'jobs', pendingJobs.length, 'Total Active Jobs', 'View all jobs \u2192', canOpenJobs ? 'jobs' : 'overview'],
        ['orange', 'clock', dueTodayJobs.length, 'Due Today', 'View all jobs \u2192', canOpenJobs ? 'jobs' : 'overview'],
        ['red', 'alert', overdueJobs.length, 'Overdue Jobs', 'View all jobs \u2192', canOpenJobs ? 'jobs' : 'overview'],
        ['green', 'completed', completedJobs.length, 'Completed Jobs', 'View all jobs \u2192', canOpenJobs ? 'jobs' : 'overview'],
        ['blue', 'users', activeEmployees, 'Active Employees', 'Manage team \u2192', can(data, 'employees.view') ? 'employees' : 'overview'],
        ['purple', 'users', activeClients, 'Active Clients', 'Manage clients \u2192', canAny(data, ['clients.view_all', 'clients.view']) ? 'clients' : 'overview'],
        ['purple', 'support', openTickets, 'Open Tickets', 'View all tickets \u2192', canOpenSupport ? 'support' : 'overview']
    ];
    const activities = recentActivityItems(data);
    const dueLabel = due => validDue(due) ? due.toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Date unavailable';
    const activityIcon = item => item.tab === 'support' ? 'support' : item.tab === 'clients' ? 'users' : 'jobs';
    const primaryAction = (() => {
        if (['super_admin', 'admin'].includes(dashboardProfile.roleKey)) {
            if (canAny(data, ['users.create', 'employees.create']))
                return ['Add User', 'users', 'plus'];
            if (can(data, 'departments.manage'))
                return ['Departments', 'users', 'users'];
        }
        if (can(data, 'jobs.create'))
            return ['Submit a Job', 'submit', 'plus'];
        if (canOpenJobs)
            return ['Open Jobs', 'jobs', 'jobs'];
        return null;
    })();
    return _jsx("section", { className: "overview-reference", children: _jsxs(_Fragment, { children: [
                _jsxs("div", { className: "overview-reference-head", children: [
                        _jsxs("div", { children: [_jsx("h2", { children: dashboardProfile.overviewTitle }), _jsx("span", { "aria-hidden": "true" })] }),
                        primaryAction && _jsxs("button", { type: "button", className: "overview-submit-button", onClick: () => setTab(primaryAction[1]), children: [_jsx(DashboardIcon, { name: primaryAction[2] }), primaryAction[0]] })
                    ] }),
                _jsx("section", { className: "overview-metric-row", "aria-label": "Workspace metrics", children: metricCards.map(([tone, icon, value, label, action, target]) => _jsxs("button", { type: "button", className: `overview-metric-card ${tone}`, onClick: () => setTab(target), children: [_jsx("span", { className: "overview-metric-icon", children: _jsx(DashboardIcon, { name: icon }) }), _jsxs("span", { className: "overview-metric-copy", children: [_jsx("small", { children: label }), _jsx("strong", { children: value }), _jsx("em", { children: action })] })] }, label)) }),
                _jsxs("section", { className: "overview-analytics-grid", children: [
                        _jsxs("article", { className: "overview-chart-card", children: [
                                _jsx("h3", { children: "Jobs by Status" }),
                                statusRows.length ? _jsxs("div", { className: "overview-status-chart", children: [
                                        _jsxs("div", { className: "overview-donut", style: { background: `conic-gradient(${donutSegments.join(', ')})` }, children: [_jsx("span", { children: "Total" }), _jsx("strong", { children: jobs.length })] }),
                                        _jsx("div", { className: "overview-status-legend", children: statusRows.map(row => _jsxs("button", { type: "button", onClick: () => setTab(canOpenJobs ? 'jobs' : 'overview'), style: { '--status-color': row.color }, children: [_jsx("span", { className: "overview-legend-dot" }), _jsx("b", { children: row.label }), _jsxs("small", { children: [row.count, " (", row.percent.toFixed(1), "%)"] })] }, row.key)) })
                                    ] }) : _jsx(DashboardEmptyState, { title: "No job status yet.", body: "Live job status totals will appear here once jobs are submitted." })
                            ] }),
                        _jsxs("article", { className: "overview-chart-card", children: [
                                _jsx("h3", { children: "Jobs by Priority" }),
                                _jsx("div", { className: "overview-priority-chart", children: priorityRows.map(row => _jsxs("button", { type: "button", className: "overview-priority-item", onClick: () => setTab(canOpenJobs ? 'jobs' : 'overview'), children: [_jsx("span", { className: "overview-priority-value", children: row.count }), _jsx("span", { className: "overview-priority-bar", style: { height: `${row.count ? Math.max(12, row.count / maxPriority * 100) : 0}%`, background: row.color } }), _jsx("span", { className: "overview-priority-label", children: row.label })] }, row.label)) })
                            ] })
                    ] }),
                _jsxs("section", { className: "overview-workload-grid", children: [
                        _jsx(WorkloadPanel, { title: "Department Workload", rows: departmentWorkload, emptyTitle: "No department workload.", emptyBody: "Department assignments will appear here once active jobs are assigned." }),
                        _jsx(WorkloadPanel, { title: "Employee Workload", rows: employeeWorkload, emptyTitle: "No employee workload.", emptyBody: "Assigned employee workload will appear here once jobs are assigned." })
                    ] }),
                _jsxs("section", { className: "overview-lower-grid", children: [
                        _jsxs("article", { className: "overview-list-card", children: [
                                _jsx("h3", { children: "Jobs Due Soon" }),
                                dueSoonJobs.length ? _jsx("div", { className: "overview-due-list", children: dueSoonJobs.map(({ job, due }) => _jsxs("button", { type: "button", className: "overview-due-row", onClick: () => setTab(canOpenJobs ? 'jobs' : 'overview'), children: [_jsx("span", { className: "overview-due-icon", children: _jsx(DashboardIcon, { name: "calendar" }) }), _jsxs("span", { className: "overview-due-main", children: [_jsx("b", { children: job.id }), _jsx("strong", { children: job.title }), _jsx("small", { children: clientNameFor(data, job.clientId) })] }), _jsx("span", { className: "overview-due-time", children: dueLabel(due) }), _jsx("span", { className: `overview-priority-pill ${job.priority.toLowerCase()}`, children: job.priority })] }, job.id)) }) : _jsx(DashboardEmptyState, { title: "No due jobs.", body: "Upcoming job deadlines will appear here." }),
                                _jsxs("button", { type: "button", className: "overview-list-link", onClick: () => setTab(canOpenJobs ? 'jobs' : 'overview'), children: ["View all jobs due soon", _jsx(DashboardIcon, { name: "arrow" })] })
                            ] }),
                        _jsxs("article", { className: "overview-list-card", children: [
                                _jsx("h3", { children: "Recent Activity" }),
                                activities.length ? _jsx("div", { className: "overview-activity-feed", children: activities.map(item => _jsxs("button", { type: "button", className: `overview-activity-row ${item.tone}`, onClick: () => setTab(item.tab), children: [_jsx("span", { className: "overview-activity-icon", children: _jsx(DashboardIcon, { name: activityIcon(item) }) }), _jsxs("span", { className: "overview-activity-copy", children: [_jsx("b", { children: item.description }), _jsx("small", { children: shortDateTime(item.date) })] }), _jsx("time", { children: relativeTime(item.date) })] }, item.id)) }) : _jsx(DashboardEmptyState, { title: "No recent activity.", body: "Job, ticket, and client updates will appear here." }),
                                _jsxs("button", { type: "button", className: "overview-list-link", onClick: () => setTab(canOpenAudit ? 'audit' : 'overview'), children: ["View all activity", _jsx(DashboardIcon, { name: "arrow" })] })
                            ] })
                    ] })
            ] }) });
}
function WorkloadPanel({ title, rows, emptyTitle, emptyBody }) {
    const max = Math.max(1, ...rows.map(row => row.count));
    return (
        <article className="overview-list-card overview-workload-card">
            <h3>{title}</h3>
            {rows.length ? (
                <div className="overview-workload-list">
                    {rows.map(row => (
                        <div className="overview-workload-row" key={row.label}>
                            <div>
                                <b>{row.label}</b>
                                <small>{row.count} active job{row.count === 1 ? '' : 's'}{row.urgent ? `, ${row.urgent} urgent` : ''}</small>
                            </div>
                            <span className="overview-workload-meter" aria-hidden="true">
                                <i style={{ width: `${Math.max(10, row.count / max * 100)}%` }} />
                            </span>
                            <strong>{row.count}</strong>
                        </div>
                    ))}
                </div>
            ) : <DashboardEmptyState title={emptyTitle} body={emptyBody} />}
        </article>
    );
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
function Submit({ data, reload }) {
    const first = data.settings.categories[0]?.name || '';
    const activeClients = useMemo(() => data.clients.filter(c => c.status === 'active'), [data.clients]);
    const assignees = data.assignees || [];
    const departments = data.departments || [];
    const canAssign = canAny(data, ['jobs.assign', 'jobs.reassign']);
    const showClientSelector = data.user.accountType !== 'client' && activeClients.length > 0;
    const emptyForm = {
        clientId: data.user.clientId || activeClients[0]?.id || '',
        title: '',
        description: '',
        category: first,
        priority: 'Medium',
        postedBy: '',
        assetLink: '',
        assignedToUserId: '',
        departmentId: '',
        assignmentNote: ''
    };
    const [form, setForm] = useState(emptyForm);
    const [message, setMessage] = useState('');
    const setAssignee = assignedToUserId => {
        const selected = assignees.find(user => user.id === assignedToUserId);
        setForm(current => ({
            ...current,
            assignedToUserId,
            departmentId: selected?.departmentId || current.departmentId
        }));
    };
    const submit = async (e) => {
        e.preventDefault();
        try {
            await api.createJob(canAssign ? form : {
                clientId: form.clientId,
                title: form.title,
                description: form.description,
                category: form.category,
                priority: form.priority,
                postedBy: form.postedBy,
                assetLink: form.assetLink
            });
            setMessage(form.assignedToUserId ? 'Job submitted and assigned successfully.' : 'Job submitted successfully. All logged-in users will receive the update instantly.');
            setForm(current => ({ ...emptyForm, clientId: current.clientId, category: current.category, priority: current.priority }));
            await reload();
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    return (
        <form className="card form" onSubmit={submit}>
            <h2>New job request</h2>
            {message && <div className="alert">{message}</div>}
            {showClientSelector && (
                <label>Client
                    <select value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}>
                        {activeClients.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
                    </select>
                </label>
            )}
            <label>Job title
                <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>Description
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="row">
                <label>Category
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                        {data.settings.categories.map(c => <option key={c.name}>{c.name}</option>)}
                    </select>
                </label>
                <label>Priority
                    <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                        <option>Low</option>
                        <option>Medium</option>
                        <option>High</option>
                        <option>Urgent</option>
                    </select>
                </label>
            </div>
            {canAssign && (
                <>
                    <div className="row">
                        <label>Assign to employee
                            <select value={form.assignedToUserId} onChange={e => setAssignee(e.target.value)}>
                                <option value="">Unassigned</option>
                                {assignees.map(user => <option value={user.id} key={user.id}>{assigneeLabelFor(user)}</option>)}
                            </select>
                        </label>
                        <label>Department
                            <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                                <option value="">No department</option>
                                {departments.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                            </select>
                        </label>
                    </div>
                    <label>Assignment note
                        <input value={form.assignmentNote} onChange={e => setForm({ ...form, assignmentNote: e.target.value })} placeholder="Optional instruction for the employee or team leader" />
                    </label>
                </>
            )}
            <label>Asset link
                <input value={form.assetLink} onChange={e => setForm({ ...form, assetLink: e.target.value })} placeholder="Google Drive, Dropbox or another secure URL" />
            </label>
            <label>Posted by
                <input required value={form.postedBy} onChange={e => setForm({ ...form, postedBy: e.target.value })} />
            </label>
            <button className="primary">Submit job</button>
        </form>
    );
}
function Jobs({ data, reload }) {
    const [category, setCategory] = useState('');
    const [priority, setPriority] = useState('');
    const [client, setClient] = useState('');
    const [query, setQuery] = useState(() => {
        try {
            return sessionStorage.getItem('ci360-job-search') || '';
        }
        catch {
            return '';
        }
    });
    useEffect(() => {
        const syncSearch = () => {
            try {
                setQuery(sessionStorage.getItem('ci360-job-search') || '');
            }
            catch { }
        };
        window.addEventListener('ci360-job-search', syncSearch);
        return () => window.removeEventListener('ci360-job-search', syncSearch);
    }, []);
    const resetFilters = () => {
        setCategory('');
        setPriority('');
        setClient('');
        setQuery('');
        try {
            sessionStorage.removeItem('ci360-job-search');
        }
        catch { }
    };
    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        return data.jobs.filter(job => {
            const haystack = [job.id, job.title, job.description, job.postedBy, job.category, job.priority, statusLabels[job.status], clientNameFor(data, job.clientId)].filter(Boolean).join(' ').toLowerCase();
            return (!category || job.category === category) && (!priority || job.priority === priority) && (!client || job.clientId === client) && (!term || haystack.includes(term));
        });
    }, [data, category, priority, client, query]);
    const pending = useMemo(() => filtered.filter(isPendingJob).sort((a, b) => {
        const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
        return priorityDiff || new Date(a.datePosted).getTime() - new Date(b.datePosted).getTime();
    }), [filtered]);
    const completed = useMemo(() => filtered.filter(isCompletedJob).sort((a, b) => new Date(dateForMonth(b)).getTime() - new Date(dateForMonth(a)).getTime()), [filtered]);
    return _jsxs(_Fragment, { children: [
            _jsx(CategoryLoadGrid, { data: data }),
            _jsxs("div", { className: "filters", children: [
                    _jsx("input", { value: query, onChange: e => setQuery(e.target.value), placeholder: "Search jobs", "aria-label": "Search jobs" }),
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
    const changeAssignee = assignedToUserId => {
        const selected = (data.assignees || []).find(user => user.id === assignedToUserId);
        setAssignee(assignedToUserId);
        if (selected?.departmentId && !department)
            setDepartment(selected.departmentId);
    };
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
                    canAssign && _jsxs("select", { value: assignee, onChange: e => changeAssignee(e.target.value), "aria-label": "Assigned employee", children: [_jsx("option", { value: "", children: "Unassigned" }), (data.assignees || []).map(user => _jsx("option", { value: user.id, children: assigneeLabelFor(user) }, user.id))] }),
                    canAssign && _jsxs("select", { value: department, onChange: e => setDepartment(e.target.value), "aria-label": "Job department", children: [_jsx("option", { value: "", children: "No department" }), (data.departments || []).map(item => _jsx("option", { value: item.id, children: item.name }, item.id))] }),
                    canAssign && _jsx("input", { value: assignmentNote, onChange: e => setAssignmentNote(e.target.value), placeholder: "Assignment note" }),
                    _jsx("button", { type: "button", onClick: save, children: "Save" })
                ] })
        ] });
}
function SettingsPanel({ initial, reload }) { const [s, setS] = useState(initial); const save = async () => { await api.saveSettings(s); await reload(); alert('TAT standards saved.'); }; return _jsxs("section", { className: "card", children: [_jsx("h2", { children: "TAT standards" }), s.categories.map((c, i) => _jsxs("div", { className: "setting-row", children: [_jsx("input", { value: c.name, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, name: e.target.value } : x) }) }), _jsx("input", { type: "number", min: "1", value: c.baseHours, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, baseHours: Number(e.target.value) } : x) }) }), _jsx("button", { onClick: () => setS({ ...s, categories: s.categories.filter((_, n) => n !== i) }), children: "Remove" })] }, i)), _jsx("button", { onClick: () => setS({ ...s, categories: [...s.categories, { name: 'New category', baseHours: 24 }] }), children: "+ Add category" }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category capacity", _jsx("input", { type: "number", value: s.capacityPerCategory, onChange: e => setS({ ...s, capacityPerCategory: Number(e.target.value) }) })] }), _jsxs("label", { children: ["Extra hours over capacity", _jsx("input", { type: "number", value: s.bufferHoursPerExtraJob, onChange: e => setS({ ...s, bufferHoursPerExtraJob: Number(e.target.value) }) })] })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Start hour", _jsx("input", { type: "number", step: "0.5", value: s.startHour, onChange: e => setS({ ...s, startHour: Number(e.target.value) }) })] }), _jsxs("label", { children: ["End hour", _jsx("input", { type: "number", step: "0.5", value: s.endHour, onChange: e => setS({ ...s, endHour: Number(e.target.value) }) })] })] }), _jsx("button", { className: "primary", onClick: save, children: "Save standards" })] }); }
function SystemSettings({ data }) {
    const enabledModules = data.modules || [];
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>System Controls</span>
                    <h2>Settings</h2>
                    <p>Workspace-level controls available to Super Admin and permitted administrators.</p>
                </div>
            </div>
            <div className="management-stats">
                <DashboardStat tone="blue" icon="settings" value={enabledModules.length} label="Visible Modules" support="Based on live permissions" />
                <DashboardStat tone="green" icon="shield" value={(data.permissions || []).length} label="Granted Permissions" support="Current effective access" />
                <DashboardStat tone="purple" icon="clock" value={data.settings?.categories?.length || 0} label="TAT Categories" support="Managed under TAT Standards" />
            </div>
            <article className="dashboard-card management-card">
                <div className="dashboard-card-head">
                    <div>
                        <h3>Workspace Access</h3>
                        <p>These modules are visible for the current account. Use Users & Roles to change access rules.</p>
                    </div>
                </div>
                <div className="system-settings-grid">
                    {enabledModules.map(module => (
                        <div className="system-settings-item" key={module.id}>
                            <DashboardIcon name={dashboardTabIcons[module.id] || 'overview'} />
                            <div>
                                <b>{module.label || knownDashboardTabs[module.id] || module.id}</b>
                                <small>{dashboardTabDescriptions[module.id] || 'Workspace module'}</small>
                            </div>
                        </div>
                    ))}
                </div>
            </article>
        </section>
    );
}
function Clients({ data, reload }) {
    const [form, setForm] = useState({ id: '', name: '', password: '' });
    const [passwords, setPasswords] = useState({});
    const [message, setMessage] = useState('');
    const canCreateClient = can(data, 'clients.create');
    const canEditClient = can(data, 'clients.edit');
    const canDeleteClient = can(data, 'clients.delete');
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
                            {canEditClient && <th>New Password</th>}
                            {(canEditClient || canDeleteClient) && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {data.clients.map(client => (
                            <tr key={client.id}>
                                <td data-label="Client ID"><b>{client.id}</b></td>
                                <td data-label="Name">{client.name}</td>
                                <td data-label="Status"><span className={`status-pill ${client.status}`}>{client.status}</span></td>
                                {canEditClient && (
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
                                )}
                                {(canEditClient || canDeleteClient) && (
                                    <td data-label="Actions">
                                        <div className="client-actions">
                                            {canEditClient && <button type="button" className="primary small" onClick={() => resetPassword(client.id)}>Reset Password</button>}
                                            {canEditClient && (
                                                <button type="button" className={client.status === 'active' ? 'danger small' : 'small'} onClick={() => toggleClient(client.id, client.status)}>
                                                    {client.status === 'active' ? 'Archive' : 'Restore'}
                                                </button>
                                            )}
                                            {canDeleteClient && <button type="button" className="danger small" onClick={() => deleteClient(client)}>Delete</button>}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {canCreateClient && (
                <>
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
                </>
            )}
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
                    <tr>{columns.map(column => <th className={`col-${column.key}`} key={column.key}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.id}>
                            {columns.map(column => (
                                <td className={`col-${column.key}`} data-label={column.label} key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Employees({ data, setTab }) {
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
    const openUserManager = (intent, panel = 'users') => {
        try {
            sessionStorage.setItem('ci360-users-panel', panel);
            if (intent)
                sessionStorage.setItem('ci360-open-user-modal', intent);
        }
        catch { }
        setTab('users');
    };
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>Employee Management</span>
                    <h2>Employees</h2>
                    <p>Internal users, reporting-ready roles, and access status.</p>
                </div>
                <div className="management-header-actions">
                    {canAny(data, ['users.create', 'employees.create']) && <button type="button" className="overview-submit-button" onClick={() => openUserManager('employee')}><DashboardIcon name="plus" />Add Employee</button>}
                    {can(data, 'departments.manage') && <button type="button" onClick={() => openUserManager('', 'departments')}>Departments</button>}
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

const blankUserForm = {
    id: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    accountType: 'employee',
    roleId: '',
    status: 'active',
    clientId: '',
    employeeId: '',
    joiningDate: '',
    departmentId: '',
    designationId: '',
    managerUserId: ''
};
const accountTypeLabel = value => ({ super_admin: 'Super Admin', admin: 'Admin', employee: 'Employee', client: 'Client', internal: 'Internal' }[value] || value || '-');
const statusText = value => value === 'archived' ? 'Inactive' : value === 'inactive' ? 'Inactive' : 'Active';
const normalized = value => String(value || '').trim().toLowerCase();
const cleanUserId = value => normalized(value).replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '') || 'employee';
const uniqueUserIdFor = (seed, users) => {
    const base = cleanUserId(seed);
    const used = new Set(users.map(user => normalized(user.id)));
    if (!used.has(base))
        return base;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${base}${index}`;
        if (!used.has(candidate))
            return candidate;
    }
    return `${base}${Date.now().toString(36)}`;
};
const userConflictFor = (form, users, editingUser = null) => {
    const currentId = normalized(editingUser?.id);
    const id = normalized(form.id);
    const email = normalized(form.email);
    const employeeId = normalized(form.employeeId);
    if (id && users.some(user => normalized(user.id) === id && normalized(user.id) !== currentId))
        return `User ID "${form.id}" already exists. Use another User ID.`;
    if (email && users.some(user => normalized(user.email) === email && normalized(user.id) !== currentId))
        return `Email "${form.email}" already exists. Use another email address.`;
    if (!editingUser && form.accountType !== 'client' && employeeId && users.some(user => normalized(user.employeeId) === employeeId))
        return `Employee ID "${form.employeeId}" already exists. Use another Employee ID.`;
    return '';
};

function UsersRoles({ data, reload }) {
    const [activePanel, setActivePanel] = useState('users');
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [modules, setModules] = useState([]);
    const [moduleAccessRules, setModuleAccessRules] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [designations, setDesignations] = useState([]);
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [draftPermissions, setDraftPermissions] = useState([]);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(blankUserForm);
    const [userModalOpen, setUserModalOpen] = useState(false);
    const [userFormError, setUserFormError] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [userSearch, setUserSearch] = useState('');
    const [userFilters, setUserFilters] = useState({ accountType: '', roleId: '', departmentId: '', designationId: '', status: '' });
    const [roleForm, setRoleForm] = useState({ name: '', description: '', roleType: 'internal', level: 40 });
    const loadManagement = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [usersResult, rolesResult, permissionsResult, modulesResult, moduleAccessResult, departmentsResult, designationsResult] = await Promise.all([
                canAny(data, ['users.view', 'employees.view']) ? api.users() : Promise.resolve({ users: [] }),
                canAny(data, ['roles.view', 'users.create', 'users.edit', 'users.assign_role', 'employees.create', 'employees.edit']) ? api.roles() : Promise.resolve({ roles: [] }),
                canAny(data, ['roles.view', 'roles.manage_permissions']) ? api.permissions() : Promise.resolve({ permissions: [] }),
                canAny(data, ['modules.view_access_rules', 'modules.manage_access']) ? api.modules() : Promise.resolve({ modules: [] }),
                canAny(data, ['modules.view_access_rules', 'modules.manage_access']) ? api.moduleAccess() : Promise.resolve({ rules: [] }),
                canAny(data, ['departments.manage', 'users.view', 'users.create', 'users.edit', 'employees.view', 'employees.create', 'employees.edit']) ? api.departments() : Promise.resolve({ departments: [] }),
                canAny(data, ['designations.manage', 'users.view', 'users.create', 'users.edit', 'employees.view', 'employees.create', 'employees.edit']) ? api.designations() : Promise.resolve({ designations: [] })
            ]);
            setUsers(usersResult.users || []);
            setRoles(rolesResult.roles || []);
            setPermissions(permissionsResult.permissions || []);
            setModules(modulesResult.modules || []);
            setModuleAccessRules(moduleAccessResult.rules || []);
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
    const canCreateFullUsers = can(data, 'users.create');
    const canCreateEmployeeUsers = can(data, 'employees.create');
    const canEditUsers = canAny(data, ['users.edit', 'employees.edit']);
    const canEditRoles = can(data, 'roles.edit');
    const managementTabs = useMemo(() => [
        canAny(data, ['users.view', 'users.create', 'users.edit', 'employees.view', 'employees.create', 'employees.edit']) && ['users', 'Users'],
        can(data, 'roles.view') && ['roles', 'Roles'],
        can(data, 'roles.manage_permissions') && ['permissions', 'Permissions'],
        canAny(data, ['modules.view_access_rules', 'modules.manage_access']) && ['moduleAccess', 'Module Access'],
        can(data, 'departments.manage') && ['departments', 'Departments'],
        can(data, 'designations.manage') && ['designations', 'Designations'],
        canAny(data, ['users.view', 'employees.view']) && ['hierarchy', 'Hierarchy']
    ].filter(Boolean), [data]);
    useEffect(() => {
        if (managementTabs.length && !managementTabs.some(([id]) => id === activePanel))
            setActivePanel(managementTabs[0][0]);
    }, [activePanel, managementTabs]);
    useEffect(() => {
        if (roleOptions.some(role => role.id === form.roleId)) return;
        setForm(current => ({ ...current, roleId: roleOptions[0]?.id || '' }));
    }, [form.accountType, form.roleId, roleOptions]);
    const userSummaryCards = useMemo(() => [
        ['blue', 'users', users.length, 'Total Users', 'All workspace accounts'],
        ['purple', 'shield', users.filter(user => user.accountType === 'super_admin').length, 'Super Admins', 'Full platform access'],
        ['blue', 'users', users.filter(user => user.accountType === 'admin').length, 'Admins', 'Permission-controlled admins'],
        ['green', 'users', users.filter(user => user.accountType === 'employee').length, 'Employees', 'Internal delivery team'],
        ['gold', 'users', users.filter(user => user.accountType === 'client').length, 'Clients', 'External client access']
    ], [users]);
    const filteredUsers = useMemo(() => {
        const term = userSearch.trim().toLowerCase();
        return users.filter(user => {
            const matchesSearch = !term || [user.name, user.email, user.id, user.roleName, user.departmentName, user.designationName, user.managerName, user.clientName].filter(Boolean).join(' ').toLowerCase().includes(term);
            return matchesSearch
                && (!userFilters.accountType || user.accountType === userFilters.accountType)
                && (!userFilters.roleId || user.roleId === userFilters.roleId)
                && (!userFilters.departmentId || String(user.departmentId || '') === String(userFilters.departmentId))
                && (!userFilters.designationId || String(user.designationId || '') === String(userFilters.designationId))
                && (!userFilters.status || user.status === userFilters.status);
        });
    }, [users, userSearch, userFilters]);
    const setUserFilter = (key, value) => setUserFilters(current => ({ ...current, [key]: value }));
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
    const openUserModal = (user = null) => {
        setMessage('');
        setError('');
        setUserFormError('');
        if (user) {
            setEditingUser(user);
            setForm({
                ...blankUserForm,
                id: user.id || '',
                name: user.name || '',
                email: user.email || '',
                phone: user.phone || '',
                password: '',
                accountType: user.accountType || 'employee',
                roleId: user.roleId || '',
                status: user.status || 'active',
                clientId: user.clientId || '',
                employeeId: user.employeeId || '',
                joiningDate: user.joiningDate ? String(user.joiningDate).slice(0, 10) : '',
                departmentId: user.departmentId || '',
                designationId: user.designationId || '',
                managerUserId: user.managerUserId || ''
            });
        }
        else {
            setEditingUser(null);
            setForm({ ...blankUserForm, roleId: roleOptions[0]?.id || '' });
        }
        setUserModalOpen(true);
    };
    const closeUserModal = () => {
        setUserModalOpen(false);
        setUserFormError('');
        setEditingUser(null);
        setForm({ ...blankUserForm, roleId: roleOptions[0]?.id || '' });
    };
    useEffect(() => {
        if (userModalOpen)
            return;
        let requestedPanel = '';
        let requestedModal = '';
        try {
            requestedPanel = sessionStorage.getItem('ci360-users-panel') || '';
            requestedModal = sessionStorage.getItem('ci360-open-user-modal') || '';
        }
        catch { }
        if (requestedPanel && managementTabs.some(([id]) => id === requestedPanel)) {
            setActivePanel(requestedPanel);
            try { sessionStorage.removeItem('ci360-users-panel'); }
            catch { }
        }
        if (requestedModal === 'employee') {
            if (!roleOptions.length)
                return;
            setEditingUser(null);
            setUserFormError('');
            setForm({
                ...blankUserForm,
                accountType: 'employee',
                roleId: roleOptions.find(role => role.id === 'employee')?.id || roleOptions[0]?.id || ''
            });
            setActivePanel('users');
            setUserModalOpen(true);
            try { sessionStorage.removeItem('ci360-open-user-modal'); }
            catch { }
        }
    }, [managementTabs, roleOptions, userModalOpen]);
    const saveUser = async event => {
        event.preventDefault();
        setUserFormError('');
        setError('');
        const duplicateMessage = userConflictFor(form, users, editingUser);
        if (duplicateMessage) {
            setUserFormError(duplicateMessage);
            return;
        }
        if (!editingUser && !canCreateFullUsers && form.accountType !== 'employee') {
            setUserFormError('You can create employee accounts only.');
            return;
        }
        try {
            if (editingUser) {
                const patch = {
                    name: form.name,
                    email: form.email,
                    phone: form.phone,
                    roleId: form.roleId,
                    status: form.status
                };
                if (form.accountType !== 'client') {
                    patch.departmentId = form.departmentId;
                    patch.designationId = form.designationId;
                    patch.managerUserId = form.managerUserId;
                }
                if (form.password)
                    patch.password = form.password;
                await api.updateUser(editingUser.id, patch);
                setMessage('User updated successfully.');
            }
            else {
                await api.createUser(form);
                setMessage('User created successfully.');
            }
            closeUserModal();
            setActivePanel('users');
            await loadManagement();
            await reload?.();
        }
        catch (err) {
            setUserFormError(err.message);
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
    const selectedClient = data.clients.find(client => client.id === form.clientId);
    return (
        <section className="management-page">
            <div className="management-header">
                <div>
                    <span>Access Control</span>
                    <h2>Users & Roles</h2>
                    <p>Manage users, roles, permissions, departments, designations and organizational access.</p>
                </div>
                {canAny(data, ['users.create', 'employees.create']) && <button type="button" className="overview-submit-button" onClick={() => openUserModal()}><DashboardIcon name="plus" />{canCreateFullUsers ? 'Add User' : 'Add Employee'}</button>}
            </div>
            {message && <div className="alert success">{message}</div>}
            {error && <div className="alert error">{error}</div>}
            <div className="management-tabs" role="tablist" aria-label="Users and roles sections">
                {managementTabs.map(([id, label]) => (
                    <button type="button" className={activePanel === id ? 'active' : ''} onClick={() => setActivePanel(id)} key={id}>{label}</button>
                ))}
            </div>
            {userModalOpen && (
                <div className="modal-backdrop user-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
                    <form className="modal-panel user-modal" onSubmit={saveUser}>
                        <div className="modal-head">
                            <div>
                                <span className="modal-kicker">Workspace Access</span>
                                <h2 id="user-modal-title">{editingUser ? 'Edit User' : 'Add User'}</h2>
                                <p>{editingUser ? 'Update account access and organizational placement.' : 'Create a secure workspace account with role-based access.'}</p>
                            </div>
                            <button type="button" className="icon-button" aria-label="Close user form" onClick={closeUserModal}>x</button>
                        </div>
                        {userFormError && <div className="alert error modal-alert">{userFormError}</div>}
                        <div className="modal-section">
                            <h3>Personal Information</h3>
                            <div className="row">
                                <label>User ID
                                    <input required disabled={Boolean(editingUser)} value={form.id} onChange={event => setForm({ ...form, id: event.target.value })} />
                                    {!editingUser && userConflictFor({ ...form, email: '', employeeId: '' }, users) && <button type="button" className="field-action" onClick={() => setForm(current => ({ ...current, id: uniqueUserIdFor(current.id || current.name, users) }))}>Use available ID</button>}
                                </label>
                                <label>Full Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value, id: !editingUser && !form.id ? uniqueUserIdFor(event.target.value, users) : form.id })} /></label>
                            </div>
                            <div className="row">
                                <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
                                <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
                            </div>
                        </div>
                        <div className="modal-section">
                            <h3>Account</h3>
                            <div className="row">
                                <label>Account Type
                                    <select disabled={Boolean(editingUser) || (!canCreateFullUsers && canCreateEmployeeUsers)} value={form.accountType} onChange={event => setForm({ ...form, accountType: event.target.value, clientId: '', departmentId: '', designationId: '', managerUserId: '' })}>
                                        <option value="employee">Employee</option>
                                        {canCreateFullUsers && canManageSuperAdmin && <option value="admin">Admin</option>}
                                        {canCreateFullUsers && <option value="client">Client</option>}
                                        {canCreateFullUsers && canManageSuperAdmin && <option value="super_admin">Super Admin</option>}
                                    </select>
                                </label>
                                <label>Role
                                    <select required value={form.roleId} onChange={event => setForm({ ...form, roleId: event.target.value })}>
                                        {roleOptions.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
                                    </select>
                                </label>
                                <label>Status
                                    <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>
                                        <option value="active">Active</option>
                                        <option value="archived">Inactive</option>
                                    </select>
                                </label>
                            </div>
                            <label>{editingUser ? 'New Password (optional)' : 'Temporary Password'}<input required={!editingUser} type="password" minLength={8} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
                        </div>
                        {form.accountType === 'client' ? (
                            <div className="modal-section">
                                <h3>Client Information</h3>
                                <div className="row">
                                    <label>Client / Company
                                        <select required value={form.clientId} onChange={event => setForm({ ...form, clientId: event.target.value })}>
                                            <option value="">Select client</option>
                                            {data.clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}
                                        </select>
                                    </label>
                                    <label>Contact Person<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                                    <label>Account Owner
                                        <select value={selectedClient?.accountOwnerUserId || ''} disabled>
                                            <option value="">Not assigned</option>
                                            {(data.clientOwners || internalUsers).map(user => <option value={user.id} key={user.id}>{user.name}</option>)}
                                        </select>
                                    </label>
                                </div>
                                <p className="field-note">Client users are linked to an existing client/company. Manage company owner details in Manage Clients.</p>
                            </div>
                        ) : (
                            <div className="modal-section">
                                <h3>{form.accountType === 'admin' ? 'Admin Information' : 'Employee Information'}</h3>
                                <div className="row">
                                    <label>Employee ID<input value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })} /></label>
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
                                            {internalUsers.filter(user => user.id !== form.id).map(user => <option value={user.id} key={user.id}>{user.name}</option>)}
                                        </select>
                                    </label>
                                    <label>Joining Date<input type="date" value={form.joiningDate} onChange={event => setForm({ ...form, joiningDate: event.target.value })} /></label>
                                </div>
                            </div>
                        )}
                        <div className="modal-actions">
                            <button type="button" onClick={closeUserModal}>Cancel</button>
                            <button className="primary">{editingUser ? 'Save Changes' : 'Create User'}</button>
                        </div>
                    </form>
                </div>
            )}
            {activePanel === 'users' && (
                <>
                    <div className="management-stats management-stats-users">
                        {userSummaryCards.map(([tone, icon, value, label, support]) => (
                            <DashboardStat tone={tone} icon={icon} value={value} label={label} support={support} key={label} />
                        ))}
                    </div>
                    <article className="dashboard-card management-card">
                        <div className="dashboard-card-head">
                            <div>
                                <h3>Users</h3>
                                <p>{loading ? 'Loading users...' : `${filteredUsers.length} of ${users.length} account${users.length === 1 ? '' : 's'} shown.`}</p>
                            </div>
                        </div>
                        <div className="user-filter-bar">
                            <label className="user-search-field"><DashboardIcon name="search" /><input value={userSearch} onChange={event => setUserSearch(event.target.value)} placeholder="Search users..." aria-label="Search users" /></label>
                            <select value={userFilters.accountType} onChange={event => setUserFilter('accountType', event.target.value)} aria-label="Filter by account type">
                                <option value="">Account Type</option>
                                <option value="super_admin">Super Admin</option>
                                <option value="admin">Admin</option>
                                <option value="employee">Employee</option>
                                <option value="client">Client</option>
                            </select>
                            <select value={userFilters.roleId} onChange={event => setUserFilter('roleId', event.target.value)} aria-label="Filter by role">
                                <option value="">Role</option>
                                {roles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
                            </select>
                            <select value={userFilters.departmentId} onChange={event => setUserFilter('departmentId', event.target.value)} aria-label="Filter by department">
                                <option value="">Department</option>
                                {departments.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                            </select>
                            <select value={userFilters.designationId} onChange={event => setUserFilter('designationId', event.target.value)} aria-label="Filter by designation">
                                <option value="">Designation</option>
                                {designations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                            </select>
                            <select value={userFilters.status} onChange={event => setUserFilter('status', event.target.value)} aria-label="Filter by status">
                                <option value="">Status</option>
                                <option value="active">Active</option>
                                <option value="archived">Inactive</option>
                            </select>
                        </div>
                        <ManagementTable
                            empty="No users found."
                            rows={filteredUsers}
                            columns={[
                                { key: 'name', label: 'User', render: user => <span className="user-cell"><span className="dashboard-avatar">{initialsFor(user.name)}</span><span><b>{user.name}</b><small>{user.id}</small></span></span> },
                                { key: 'email', label: 'Email', render: user => user.email || '-' },
                                { key: 'accountType', label: 'Account Type', render: user => <span className={`status-pill ${user.accountType}`}>{accountTypeLabel(user.accountType)}</span> },
                                { key: 'roleName', label: 'Role', render: user => can(data, 'users.assign_role') && user.accountType !== 'client' && user.id !== data.user.id ? <select value={user.roleId || ''} onChange={event => updateUser(user, { roleId: event.target.value })}>{roles.filter(role => role.roleType !== 'client' && (canManageSuperAdmin || Number(role.level || 0) < 80) && (user.accountType === 'super_admin' ? role.id === 'super_admin' : role.id !== 'super_admin')).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select> : user.roleName },
                                { key: 'departmentName', label: 'Department', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.departmentId || ''} onChange={event => updateUser(user, { departmentId: event.target.value })}><option value="">None</option>{departments.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : user.departmentName || '-' },
                                { key: 'designationName', label: 'Designation', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.designationId || ''} onChange={event => updateUser(user, { designationId: event.target.value })}><option value="">None</option>{designations.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : user.designationName || '-' },
                                { key: 'managerName', label: 'Reporting Manager', render: user => user.accountType === 'client' ? '-' : canEditUsers ? <select value={user.managerUserId || ''} onChange={event => updateUser(user, { managerUserId: event.target.value })}><option value="">None</option>{internalUsers.filter(manager => manager.id !== user.id).map(manager => <option value={manager.id} key={manager.id}>{manager.name}</option>)}</select> : user.managerName || '-' },
                                { key: 'status', label: 'Status', render: user => <span className={`status-pill ${user.status}`}>{statusText(user.status)}</span> },
                                { key: 'lastLogin', label: 'Last Login', render: user => user.lastLogin ? shortDateTime(user.lastLogin) : '-' },
                                { key: 'actions', label: 'Actions', render: user => (
                                    <details className="row-actions">
                                        <summary>Actions</summary>
                                        <div>
                                            <button type="button" onClick={() => openUserModal(user)}>View</button>
                                            {canEditUsers && <button type="button" onClick={() => openUserModal(user)}>Edit</button>}
                                            {can(data, 'users.assign_role') && <button type="button" onClick={() => openUserModal(user)}>Change Role</button>}
                                            {can(data, 'roles.manage_permissions') && <button type="button" onClick={() => setActivePanel('permissions')}>Set Permissions</button>}
                                            {canEditUsers && user.accountType !== 'client' && <button type="button" onClick={() => openUserModal(user)}>Change Department</button>}
                                            {canEditUsers && user.accountType !== 'client' && <button type="button" onClick={() => openUserModal(user)}>Change Designation</button>}
                                            {canEditUsers && user.accountType !== 'client' && <button type="button" onClick={() => openUserModal(user)}>Change Reporting Manager</button>}
                                            {canEditUsers && user.id !== data.user.id && <button type="button" onClick={() => updateUser(user, { status: user.status === 'active' ? 'archived' : 'active' })}>{user.status === 'active' ? 'Deactivate' : 'Activate'}</button>}
                                        </div>
                                    </details>
                                ) }
                            ]}
                        />
                    </article>
                </>
            )}
            {activePanel === 'roles' && (
                <article className="dashboard-card management-card">
                    <div className="dashboard-card-head">
                        <div>
                            <h3>Roles</h3>
                            <p>{loading ? 'Loading permission catalog...' : 'Create roles, review usage, and control module access.'}</p>
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
                            <button className="primary">+ Create Role</button>
                        </form>
                    )}
                    {roles.length ? (
                        <>
                            <div className="role-card-grid">
                                {roles.map(role => {
                                    const userCount = users.filter(user => user.roleId === role.id).length;
                                    return (
                                        <button type="button" className={selectedRoleId === role.id ? 'role-card active' : 'role-card'} onClick={() => setSelectedRoleId(role.id)} key={role.id}>
                                            <span className={`status-pill ${role.roleType}`}>{accountTypeLabel(role.id === 'super_admin' ? 'super_admin' : role.roleType)}</span>
                                            <b>{role.name}</b>
                                            <small>{userCount} user{userCount === 1 ? '' : 's'} - {(role.permissions || []).length} permissions</small>
                                            <em>{role.status}</em>
                                        </button>
                                    );
                                })}
                            </div>
                            <ManagementTable
                                empty="No roles available."
                                rows={roles}
                                columns={[
                                    { key: 'name', label: 'Role', render: role => canEditRoles && role.id !== 'super_admin' ? <input defaultValue={role.name} onBlur={event => event.target.value.trim() && event.target.value.trim() !== role.name && updateRole(role, { name: event.target.value.trim() })} /> : <b>{role.name}</b> },
                                    { key: 'roleType', label: 'Type', render: role => canEditRoles && !role.isSystem ? <select value={role.roleType} onChange={event => updateRole(role, { roleType: event.target.value })}><option value="internal">internal</option><option value="client">client</option></select> : <span className={`status-pill ${role.roleType}`}>{role.roleType}</span> },
                                    { key: 'userCount', label: 'Users', render: role => users.filter(user => user.roleId === role.id).length },
                                    { key: 'permissionCount', label: 'Permissions', render: role => (role.permissions || []).length },
                                    { key: 'description', label: 'Description', render: role => canEditRoles && role.id !== 'super_admin' ? <input defaultValue={role.description || ''} onBlur={event => event.target.value !== (role.description || '') && updateRole(role, { description: event.target.value })} /> : role.description || '-' },
                                    { key: 'level', label: 'Level', render: role => canEditRoles && role.id !== 'super_admin' ? <input type="number" min="0" max="100" defaultValue={role.level} onBlur={event => Number(event.target.value) !== Number(role.level) && updateRole(role, { level: Number(event.target.value) })} /> : role.level },
                                    { key: 'status', label: 'Status', render: role => canEditRoles && !role.isSystem ? <select value={role.status} onChange={event => updateRole(role, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> : <span className={`status-pill ${role.status}`}>{role.status}</span> },
                                    { key: 'actions', label: 'Actions', render: role => <button type="button" className="small" onClick={() => setSelectedRoleId(role.id)}>Edit</button> }
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
                            <div className="permission-actions">
                                <button type="button" onClick={() => setDraftPermissions(permissions.map(permission => permission.id))} disabled={!can(data, 'roles.manage_permissions') || selectedRole?.id === 'super_admin'}>Select All</button>
                                <button type="button" onClick={() => setDraftPermissions([])} disabled={!can(data, 'roles.manage_permissions') || selectedRole?.id === 'super_admin'}>Clear All</button>
                                <button type="button" className="primary" onClick={saveRolePermissions} disabled={!can(data, 'roles.manage_permissions') || selectedRole?.id === 'super_admin'}>Save Permissions</button>
                            </div>
                        </>
                    ) : <DashboardEmptyState title="No roles available." body="Roles will appear here after the RBAC catalog is seeded." />}
                </article>
            )}
            {activePanel === 'permissions' && <UserPermissionsPanel users={users} roles={roles} permissions={permissions} currentUser={data.user} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'moduleAccess' && <ModuleAccessPanel modules={modules} rules={moduleAccessRules} users={users} roles={roles} departments={departments} designations={designations} clients={data.clients || []} canManage={can(data, 'modules.manage_access')} reloadManagement={loadManagement} reload={reload} setMessage={setMessage} setError={setError} />}
            {activePanel === 'departments' && <DepartmentsPanel departments={departments} users={users} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'designations' && <DesignationsPanel designations={designations} users={users} reloadManagement={loadManagement} setMessage={setMessage} setError={setError} />}
            {activePanel === 'hierarchy' && <HierarchyPanel users={internalUsers} />}
        </section>
    );
}

const moduleRuleSteps = [
    ['conditions', 'Conditions', 'Choose who can access this module.', 'users'],
    ['triggers', 'Triggers', 'Choose when access becomes available.', 'alert'],
    ['advanced', 'Advanced Rules', 'Apply extra restrictions and scope.', 'shield']
];
const conditionTypeOptions = [
    ['account_type', 'Account Type'],
    ['role', 'Role'],
    ['department', 'Department'],
    ['designation', 'Designation'],
    ['user', 'Specific User'],
    ['client', 'Client'],
    ['manager', 'Reporting Manager']
];
const triggerOptions = [
    ['on_login', 'On Login'],
    ['job_assigned', 'Job Assigned'],
    ['client_assigned', 'Client Assigned'],
    ['support_ticket_assigned', 'Support Ticket Assigned'],
    ['date_range', 'Date Range'],
    ['day_of_week', 'Day of Week'],
    ['manual_activation', 'Manual Activation']
];
const advancedRuleOptions = [
    ['active_users_only', 'Active Users Only'],
    ['department', 'Department'],
    ['designation_level', 'Designation Level'],
    ['reporting_hierarchy', 'Reporting Hierarchy'],
    ['client_ownership', 'Client Ownership'],
    ['job_scope', 'Job Scope'],
    ['client_scope', 'Client Scope'],
    ['time_window', 'Time Window']
];
const accountTypeOptions = [
    ['super_admin', 'Super Admin'],
    ['admin', 'Admin'],
    ['employee', 'Employee'],
    ['client', 'Client']
];
const operatorOptions = [
    ['equals', 'Equals'],
    ['not_equals', 'Not equal'],
    ['in', 'In list'],
    ['not_in', 'Not in list'],
    ['less_or_equal', 'Less or equal'],
    ['greater_or_equal', 'Greater or equal']
];
const newCondition = () => ({ effect: 'include', conditionType: 'account_type', operator: 'equals', value: 'employee' });
const newTrigger = () => ({ triggerType: 'on_login', operator: 'equals', value: '', isActive: true });
const newAdvancedRule = () => ({ ruleType: 'active_users_only', operator: 'equals', value: 'true' });
const blankModuleRule = module => ({
    id: '',
    moduleKey: module?.id || '',
    name: `${module?.label || 'Module'} access rule`,
    description: '',
    matchMode: 'all',
    isActive: true,
    conditions: [newCondition()],
    triggers: [],
    advancedRules: [newAdvancedRule()]
});
const cloneRuleForDraft = (module, rule) => rule ? ({
    id: rule.id || '',
    moduleKey: rule.moduleKey || module?.id || '',
    name: rule.name || `${module?.label || 'Module'} access rule`,
    description: rule.description || '',
    matchMode: rule.matchMode || 'all',
    isActive: rule.isActive !== false,
    conditions: (rule.conditions || []).map(condition => ({ effect: condition.effect || 'include', conditionType: condition.conditionType || 'account_type', operator: condition.operator || 'equals', value: String(condition.value || '') })),
    triggers: (rule.triggers || []).map(trigger => ({ triggerType: trigger.triggerType || 'on_login', operator: trigger.operator || 'equals', value: String(trigger.value || ''), isActive: trigger.isActive !== false })),
    advancedRules: (rule.advancedRules || []).map(rule => ({ ruleType: rule.ruleType || 'active_users_only', operator: rule.operator || 'equals', value: String(rule.value || '') }))
}) : blankModuleRule(module);

const optionLabel = (options, value) => options.find(([id]) => String(id) === String(value))?.[1] || String(value || 'Any');
const itemLabel = (items, value, empty = 'Any') => items.find(item => String(item.id) === String(value))?.name || String(value || empty);
const ruleValues = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const formatRuleValue = (value, resolve) => {
    const values = ruleValues(value);
    return values.length ? values.map(resolve).join(', ') : 'Any';
};
const formatRange = value => String(value || '').replace('..', ' to ') || 'Configured window';
const conditionSummary = (condition, context) => {
    const type = optionLabel(conditionTypeOptions, condition.conditionType);
    const operator = optionLabel(operatorOptions, condition.operator).toLowerCase();
    const value = formatRuleValue(condition.value, item => {
        if (condition.conditionType === 'account_type')
            return optionLabel(accountTypeOptions, item);
        if (condition.conditionType === 'role')
            return itemLabel(context.roles, item);
        if (condition.conditionType === 'department')
            return itemLabel(context.departments, item);
        if (condition.conditionType === 'designation')
            return itemLabel(context.designations, item);
        if (condition.conditionType === 'user' || condition.conditionType === 'manager')
            return itemLabel(context.users, item);
        if (condition.conditionType === 'client')
            return itemLabel(context.clients, item);
        return item;
    });
    return `${type} ${operator} ${value}`;
};
const triggerSummary = trigger => {
    if (trigger.triggerType === 'on_login')
        return 'On Login';
    if (trigger.triggerType === 'manual_activation')
        return `Manual Activation ${String(trigger.value || 'active')}`;
    if (trigger.triggerType === 'date_range')
        return `Date Range ${formatRange(trigger.value)}`;
    if (trigger.triggerType === 'day_of_week')
        return `Day of Week ${trigger.value || 'selected days'}`;
    return optionLabel(triggerOptions, trigger.triggerType);
};
const advancedSummary = (rule, context) => {
    if (rule.ruleType === 'active_users_only')
        return 'Active users only';
    if (rule.ruleType === 'department')
        return `Department ${optionLabel(operatorOptions, rule.operator).toLowerCase()} ${itemLabel(context.departments, rule.value)}`;
    if (rule.ruleType === 'reporting_hierarchy')
        return `Reporting manager ${itemLabel(context.users, rule.value)}`;
    if (rule.ruleType === 'designation_level')
        return `Designation level ${optionLabel(operatorOptions, rule.operator).toLowerCase()} ${rule.value || 'set level'}`;
    if (rule.ruleType === 'job_scope')
        return `Job scope ${optionLabel([['own', 'Own Jobs'], ['assigned', 'Assigned Jobs'], ['department', 'Department Jobs'], ['all', 'All Jobs']], rule.value || 'own')}`;
    if (rule.ruleType === 'client_scope')
        return `Client scope ${optionLabel([['assigned', 'Assigned Clients'], ['owned', 'Owned Clients'], ['all', 'All Clients']], rule.value || 'owned')}`;
    if (rule.ruleType === 'time_window')
        return `Time window ${formatRange(rule.value)}`;
    return optionLabel(advancedRuleOptions, rule.ruleType);
};
const moduleRuleSummary = (draft, context) => {
    const includes = draft.conditions.filter(condition => condition.effect !== 'exclude').map(condition => conditionSummary(condition, context));
    const excludes = draft.conditions.filter(condition => condition.effect === 'exclude').map(condition => conditionSummary(condition, context));
    const triggers = draft.triggers.filter(trigger => trigger.isActive !== false).map(triggerSummary);
    const advanced = draft.advancedRules.map(rule => advancedSummary(rule, context));
    return {
        availableTo: includes.length ? includes.join('; ') : 'RBAC defaults decide access',
        except: excludes.length ? excludes.join('; ') : 'No exclusions',
        when: triggers.length ? triggers.join('; ') : 'Always after conditions pass',
        scope: advanced.length ? advanced.join('; ') : 'No extra restrictions',
        status: draft.isActive ? 'Active' : 'Disabled'
    };
};

function ModuleAccessPanel({ modules, rules, users, roles, departments, designations, clients, canManage, reloadManagement, reload, setMessage, setError }) {
    const [search, setSearch] = useState('');
    const [selectedModule, setSelectedModule] = useState(null);
    const groupedRules = useMemo(() => rules.reduce((map, rule) => {
        map[rule.moduleKey] = [...(map[rule.moduleKey] || []), rule];
        return map;
    }, {}), [rules]);
    const filteredModules = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (modules || []).filter(module => !term || [module.label, module.id, module.description, module.accessSummary].filter(Boolean).join(' ').toLowerCase().includes(term));
    }, [modules, search]);
    return (
        <article className="dashboard-card management-card module-access-page">
            <div className="dashboard-card-head">
                <div>
                    <h3>Module Access</h3>
                    <p>Control who can see and use every application module. RBAC still controls the actions inside each module.</p>
                </div>
                <label className="module-access-search"><DashboardIcon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search modules..." aria-label="Search modules" /></label>
            </div>
            {filteredModules.length ? (
                <div className="module-access-list">
                    {filteredModules.map(module => {
                        const moduleRules = groupedRules[module.id] || [];
                        return (
                            <section className="module-access-row" key={module.id}>
                                <span className={`module-access-icon ${module.clientAllowed ? 'client-safe' : ''}`}><DashboardIcon name={module.icon || 'overview'} /></span>
                                <div className="module-access-copy">
                                    <div>
                                        <h4>{module.label}</h4>
                                        <span>{module.id}</span>
                                    </div>
                                    <p>{module.description}</p>
                                    <small>{module.accessSummary || 'RBAC defaults apply'}</small>
                                </div>
                                <div className="module-access-meta">
                                    <span className={`status-pill ${module.status === 'disabled' ? 'archived' : module.protected ? 'admin' : 'active'}`}>{module.status === 'disabled' ? 'Disabled' : module.protected ? 'Protected' : 'Active'}</span>
                                    <b>{moduleRules.length} rule{moduleRules.length === 1 ? '' : 's'}</b>
                                </div>
                                <button type="button" className="module-access-manage" disabled={!canManage} onClick={() => setSelectedModule(module)}>Manage Access</button>
                            </section>
                        );
                    })}
                </div>
            ) : <DashboardEmptyState title="No modules found." body="Available modules come from the backend module catalog." />}
            {selectedModule && (
                <ModuleAccessModal
                    module={selectedModule}
                    rules={groupedRules[selectedModule.id] || []}
                    users={users}
                    roles={roles}
                    departments={departments}
                    designations={designations}
                    clients={clients}
                    onClose={() => setSelectedModule(null)}
                    onSaved={async message => {
                        setMessage(message);
                        await loadAndRefreshModuleAccess(reloadManagement, reload);
                    }}
                    setError={setError}
                />
            )}
        </article>
    );
}

async function loadAndRefreshModuleAccess(reloadManagement, reload) {
    await reloadManagement();
    await reload?.();
}

function ValuePicker({ type, value, onChange, roles, departments, designations, users, clients }) {
    const activeDepartments = departments.filter(item => item.status === 'active');
    const activeDesignations = designations.filter(item => item.status === 'active');
    const activeUsers = users.filter(item => item.status === 'active');
    const internalUsers = activeUsers.filter(item => item.accountType !== 'client');
    const optionsByType = {
        account_type: accountTypeOptions,
        role: roles.filter(item => item.status === 'active').map(item => [item.id, item.name]),
        department: activeDepartments.map(item => [String(item.id), item.name]),
        designation: activeDesignations.map(item => [String(item.id), item.name]),
        user: activeUsers.map(item => [item.id, `${item.name} (${item.id})`]),
        manager: internalUsers.map(item => [item.id, `${item.name} (${item.roleName || item.accountType})`]),
        client: clients.map(item => [item.id, item.name])
    };
    const options = optionsByType[type] || [];
    if (!options.length)
        return <input value={value} onChange={event => onChange(event.target.value)} placeholder="Value" />;
    return (
        <select value={value} onChange={event => onChange(event.target.value)}>
            <option value="">Select value</option>
            {options.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
    );
}

function TriggerValueInput({ trigger, onChange }) {
    if (trigger.triggerType === 'manual_activation') {
        return (
            <select value={trigger.value || 'active'} onChange={event => onChange(event.target.value)}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
            </select>
        );
    }
    if (trigger.triggerType === 'date_range')
        return <input value={trigger.value} onChange={event => onChange(event.target.value)} placeholder="2026-09-01..2026-09-30" />;
    if (trigger.triggerType === 'day_of_week')
        return <input value={trigger.value} onChange={event => onChange(event.target.value)} placeholder="monday,tuesday,wednesday" />;
    return <input value={trigger.value} onChange={event => onChange(event.target.value)} placeholder="Optional value" />;
}

function AdvancedValueInput({ rule, onChange, departments, users }) {
    if (rule.ruleType === 'active_users_only')
        return <select value={rule.value || 'true'} onChange={event => onChange(event.target.value)}><option value="true">Enabled</option></select>;
    if (rule.ruleType === 'department')
        return <select value={rule.value} onChange={event => onChange(event.target.value)}><option value="">Select department</option>{departments.filter(item => item.status === 'active').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>;
    if (rule.ruleType === 'designation_level')
        return <input type="number" min="0" value={rule.value} onChange={event => onChange(event.target.value)} placeholder="4" />;
    if (rule.ruleType === 'reporting_hierarchy')
        return <select value={rule.value} onChange={event => onChange(event.target.value)}><option value="">Select manager</option>{users.filter(item => item.status === 'active' && item.accountType !== 'client').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>;
    if (rule.ruleType === 'job_scope')
        return <select value={rule.value || 'own'} onChange={event => onChange(event.target.value)}><option value="own">Own Jobs</option><option value="assigned">Assigned Jobs</option><option value="department">Department Jobs</option><option value="all">All Jobs</option></select>;
    if (rule.ruleType === 'client_scope')
        return <select value={rule.value || 'owned'} onChange={event => onChange(event.target.value)}><option value="assigned">Assigned Clients</option><option value="owned">Owned Clients</option><option value="all">All Clients</option></select>;
    if (rule.ruleType === 'time_window')
        return <input value={rule.value} onChange={event => onChange(event.target.value)} placeholder="2026-09-01T10:00..2026-09-30T18:00" />;
    return <input value={rule.value} onChange={event => onChange(event.target.value)} placeholder="Value" />;
}

function ModuleAccessModal({ module, rules, users, roles, departments, designations, clients, onClose, onSaved, setError }) {
    const [step, setStep] = useState('conditions');
    const [draft, setDraft] = useState(() => cloneRuleForDraft(module, rules[0]));
    const [selectedRuleId, setSelectedRuleId] = useState(rules[0]?.id || 'new');
    const [saving, setSaving] = useState(false);
    const [testUserId, setTestUserId] = useState('');
    const [testResult, setTestResult] = useState(null);
    useEffect(() => {
        const selectedRule = selectedRuleId === 'new' ? null : rules.find(rule => rule.id === selectedRuleId);
        setDraft(cloneRuleForDraft(module, selectedRule));
        setTestResult(null);
    }, [module, rules, selectedRuleId]);
    useEffect(() => {
        if (!testUserId && users.length)
            setTestUserId(users[0].id);
    }, [users, testUserId]);
    const currentStepIndex = moduleRuleSteps.findIndex(([id]) => id === step);
    const patchCondition = (index, patch) => setDraft(current => ({
        ...current,
        conditions: current.conditions.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...patch } : condition)
    }));
    const patchTrigger = (index, patch) => setDraft(current => ({
        ...current,
        triggers: current.triggers.map((trigger, itemIndex) => itemIndex === index ? { ...trigger, ...patch } : trigger)
    }));
    const patchAdvanced = (index, patch) => setDraft(current => ({
        ...current,
        advancedRules: current.advancedRules.map((rule, itemIndex) => itemIndex === index ? { ...rule, ...patch } : rule)
    }));
    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const payload = { ...draft, moduleKey: module.id };
            if (draft.id)
                await api.updateModuleAccess(draft.id, payload);
            else
                await api.createModuleAccess(payload);
            await onSaved('Module access rule saved.');
            onClose();
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setSaving(false);
        }
    };
    const remove = async () => {
        if (!draft.id || !window.confirm('Delete this module access rule?'))
            return;
        setSaving(true);
        setError('');
        try {
            await api.deleteModuleAccess(draft.id);
            await onSaved('Module access rule deleted.');
            onClose();
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setSaving(false);
        }
    };
    const testAccess = async () => {
        if (!testUserId)
            return;
        setTestResult(null);
        try {
            setTestResult(await api.evaluateModuleAccess(module.id, testUserId));
        }
        catch (err) {
            setError(err.message);
        }
    };
    const next = () => {
        if (currentStepIndex >= moduleRuleSteps.length - 1)
            save();
        else
            setStep(moduleRuleSteps[currentStepIndex + 1][0]);
    };
    const includes = draft.conditions.filter(condition => condition.effect !== 'exclude').length;
    const excludes = draft.conditions.filter(condition => condition.effect === 'exclude').length;
    const summary = useMemo(() => moduleRuleSummary(draft, { users, roles, departments, designations, clients }), [draft, users, roles, departments, designations, clients]);
    return (
        <div className="modal-backdrop module-access-backdrop" role="dialog" aria-modal="true" aria-labelledby="module-access-title">
            <section className="modal-panel module-access-modal">
                <header className="module-access-modal-head">
                    <div>
                        <span className="modal-kicker">Module Access Settings</span>
                        <h2 id="module-access-title">{module.label}</h2>
                        <p>{module.description}</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Close module access settings" onClick={onClose}>x</button>
                </header>
                <div className="module-access-modal-body">
                    <aside className="module-access-stepper" aria-label="Module access setup sections">
                        {moduleRuleSteps.map(([id, label, body, icon]) => (
                            <button type="button" className={step === id ? 'active' : ''} onClick={() => setStep(id)} key={id}>
                                <DashboardIcon name={icon} />
                                <span><b>{label}</b><small>{body}</small></span>
                            </button>
                        ))}
                    </aside>
                    <div className="module-access-editor">
                        <div className="module-access-rule-top">
                            <label>Rule
                                <select value={selectedRuleId} onChange={event => setSelectedRuleId(event.target.value)}>
                                    {rules.map(rule => <option value={rule.id} key={rule.id}>{rule.name}</option>)}
                                    <option value="new">+ New rule</option>
                                </select>
                            </label>
                            <label>Rule Name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
                            <label>Status
                                <select value={draft.isActive ? 'active' : 'inactive'} onChange={event => setDraft({ ...draft, isActive: event.target.value === 'active' })}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Disabled</option>
                                </select>
                            </label>
                        </div>
                        {step === 'conditions' && (
                            <section className="module-access-section">
                                <div className="module-access-section-head">
                                    <div>
                                        <h3>Conditions</h3>
                                        <p>Define which users can access this module.</p>
                                    </div>
                                    <label>Match
                                        <select value={draft.matchMode} onChange={event => setDraft({ ...draft, matchMode: event.target.value })}>
                                            <option value="all">All Conditions</option>
                                            <option value="any">Any Condition</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="module-rule-builder">
                                    {draft.conditions.map((condition, index) => (
                                        <div className="module-rule-row" key={index}>
                                            <select value={condition.effect} onChange={event => patchCondition(index, { effect: event.target.value })}><option value="include">Include</option><option value="exclude">Exclude</option></select>
                                            <select value={condition.conditionType} onChange={event => patchCondition(index, { conditionType: event.target.value, value: '' })}>{conditionTypeOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                            <select value={condition.operator} onChange={event => patchCondition(index, { operator: event.target.value })}>{operatorOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                            <ValuePicker type={condition.conditionType} value={condition.value} onChange={value => patchCondition(index, { value })} roles={roles} departments={departments} designations={designations} users={users} clients={clients} />
                                            <button type="button" aria-label="Remove condition" onClick={() => setDraft(current => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                                        </div>
                                    ))}
                                </div>
                                <button type="button" className="module-access-add" onClick={() => setDraft(current => ({ ...current, conditions: [...current.conditions, newCondition()] }))}>+ Add Condition</button>
                            </section>
                        )}
                        {step === 'triggers' && (
                            <section className="module-access-section">
                                <div className="module-access-section-head"><div><h3>Triggers</h3><p>Define when this module becomes available to matched users.</p></div></div>
                                {draft.triggers.length ? (
                                    <div className="module-rule-builder">
                                        {draft.triggers.map((trigger, index) => (
                                            <div className="module-rule-row trigger" key={index}>
                                                <select value={trigger.triggerType} onChange={event => patchTrigger(index, { triggerType: event.target.value, value: '' })}>{triggerOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                                <select value={trigger.operator} onChange={event => patchTrigger(index, { operator: event.target.value })}>{operatorOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                                <TriggerValueInput trigger={trigger} onChange={value => patchTrigger(index, { value })} />
                                                <label className="module-rule-toggle"><input type="checkbox" checked={trigger.isActive} onChange={event => patchTrigger(index, { isActive: event.target.checked })} />Active</label>
                                                <button type="button" onClick={() => setDraft(current => ({ ...current, triggers: current.triggers.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                                            </div>
                                        ))}
                                    </div>
                                ) : <DashboardEmptyState title="Always available." body="No trigger is required after RBAC and conditions pass." />}
                                <button type="button" className="module-access-add" onClick={() => setDraft(current => ({ ...current, triggers: [...current.triggers, newTrigger()] }))}>+ Add Trigger</button>
                            </section>
                        )}
                        {step === 'advanced' && (
                            <section className="module-access-section">
                                <div className="module-access-section-head"><div><h3>Advanced Rules</h3><p>Add additional restrictions and scope for this module.</p></div></div>
                                <div className="module-rule-builder">
                                    {draft.advancedRules.map((rule, index) => (
                                        <div className="module-rule-row advanced" key={index}>
                                            <select value={rule.ruleType} onChange={event => patchAdvanced(index, { ruleType: event.target.value, value: event.target.value === 'active_users_only' ? 'true' : '' })}>{advancedRuleOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                            <select value={rule.operator} onChange={event => patchAdvanced(index, { operator: event.target.value })}>{operatorOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                                            <AdvancedValueInput rule={rule} onChange={value => patchAdvanced(index, { value })} departments={departments} users={users} />
                                            <button type="button" onClick={() => setDraft(current => ({ ...current, advancedRules: current.advancedRules.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                                        </div>
                                    ))}
                                </div>
                                <button type="button" className="module-access-add" onClick={() => setDraft(current => ({ ...current, advancedRules: [...current.advancedRules, newAdvancedRule()] }))}>+ Add Advanced Rule</button>
                                <div className="module-access-test">
                                    <div>
                                        <b>Test Access</b>
                                        <span>Choose a live user and verify the final backend decision.</span>
                                    </div>
                                    <select value={testUserId} onChange={event => setTestUserId(event.target.value)}>
                                        {users.map(user => <option value={user.id} key={user.id}>{user.name} - {user.roleName || user.accountType}</option>)}
                                    </select>
                                    <button type="button" onClick={testAccess}>Test</button>
                                </div>
                                {testResult && (
                                    <div className={`module-access-result ${testResult.result.allowed ? 'allowed' : 'denied'}`}>
                                        <b>FINAL: ACCESS {testResult.result.allowed ? 'ALLOWED' : 'DENIED'}</b>
                                        <span>{testResult.result.reason}</span>
                                        {(testResult.result.details || []).map((detail, index) => <small key={index}>{detail.label}: {detail.reason}</small>)}
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                </div>
                <div className="module-access-summary">
                    <div>
                        <b>{module.label} Module</b>
                        <span>{summary.status} - {includes} include, {excludes} exclude - {draft.triggers.length} trigger - {draft.advancedRules.length} advanced</span>
                    </div>
                    <div className="module-access-summary-grid">
                        <small><strong>Available to</strong>{summary.availableTo}</small>
                        <small><strong>Except</strong>{summary.except}</small>
                        <small><strong>When</strong>{summary.when}</small>
                        <small><strong>Scope</strong>{summary.scope}</small>
                    </div>
                </div>
                <footer className="module-access-actions">
                    {draft.id && <button type="button" className="danger" onClick={remove} disabled={saving}>Delete Rule</button>}
                    <span />
                    <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
                    <button type="button" onClick={save} disabled={saving}>Save & Close</button>
                    <button type="button" className="primary" onClick={next} disabled={saving}>{currentStepIndex >= moduleRuleSteps.length - 1 ? 'Save & Close' : 'Next'}</button>
                </footer>
            </section>
        </div>
    );
}

function UserPermissionsPanel({ users, roles, permissions, currentUser, reloadManagement, setMessage, setError }) {
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
    const selectedRole = roles.find(role => role.id === selectedUser?.roleId);
    const selectedRolePermissions = new Set(selectedRole?.permissions || []);
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
                    <p>Role Permission + User Override = Effective Permission.</p>
                </div>
            </div>
            {editableUsers.length ? (
                <>
                    <label className="management-select">User
                        <select value={selectedUserId} onChange={event => setSelectedUserId(event.target.value)}>
                            {editableUsers.map(user => <option value={user.id} key={user.id}>{user.name} - {user.roleName || user.accountType}</option>)}
                        </select>
                    </label>
                    {selectedUser && (
                        <div className="permission-formula-card">
                            <b>{selectedUser.name}</b>
                            <span>{selectedRole?.name || selectedUser.roleName || 'No role'} inherited access</span>
                            <small>Role Permission + User Override = Effective Permission</small>
                        </div>
                    )}
                    {selectedUser?.id === currentUser.id && <div className="alert error">You cannot change your own permission overrides.</div>}
                    {loading ? <div className="dashboard-empty management-empty"><b>Loading overrides...</b></div> : (
                        <div className="permission-groups override-groups">
                            {Object.entries(permissionGroups).map(([module, items]) => (
                                <section className="permission-group" key={module}>
                                    <h4>{module.replace(/_/g, ' ')}</h4>
                                    <div>
                                        {items.map(permission => (
                                            <label className="permission-check permission-override" key={permission.id}>
                                                <span className="permission-override-copy">
                                                    <b>{permission.id}</b>
                                                    <small>
                                                        Role: {selectedRolePermissions.has(permission.id) ? 'Allowed' : 'Denied'} -
                                                        Override: {overrideMap[permission.id] === 'grant' ? 'Granted' : overrideMap[permission.id] === 'revoke' ? 'Denied' : 'Inherit'} -
                                                        Effective: {(overrideMap[permission.id] === 'grant' || (!overrideMap[permission.id] && selectedRolePermissions.has(permission.id))) ? 'Allowed' : 'Denied'}
                                                    </small>
                                                </span>
                                                <select value={overrideMap[permission.id] || ''} onChange={event => setOverride(permission.id, event.target.value)}>
                                                    <option value="">Inherit</option>
                                                    <option value="grant">Grant</option>
                                                    <option value="revoke">Deny</option>
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

function DepartmentsPanel({ departments, users, reloadManagement, setMessage, setError }) {
    const [form, setForm] = useState({ name: '', code: '', description: '' });
    const departmentStats = useMemo(() => departments.map(department => {
        const members = users.filter(user => String(user.departmentId || '') === String(department.id) && user.accountType !== 'client');
        const head = [...members].sort((a, b) => Number(b.roleLevel || 0) - Number(a.roleLevel || 0) || Number(b.designationLevel || 0) - Number(a.designationLevel || 0))[0];
        return { ...department, employeeCount: members.length, headName: head?.name || '-' };
    }), [departments, users]);
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
                <button type="submit" form="department-create-form" className="overview-submit-button"><DashboardIcon name="plus" />Add Department</button>
            </div>
            <form id="department-create-form" className="management-form compact" onSubmit={create}>
                <div className="row">
                    <label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                    <label>Code<input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} placeholder="Auto if blank" /></label>
                    <label>Description<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
                </div>
                <button className="primary">Add Department</button>
            </form>
            <ManagementTable
                empty="No departments found."
                rows={departmentStats}
                columns={[
                    { key: 'name', label: 'Department Name', render: item => <b>{item.name}</b> },
                    { key: 'headName', label: 'Department Head' },
                    { key: 'employeeCount', label: 'Number Employees' },
                    { key: 'status', label: 'Status', render: item => <select value={item.status} onChange={event => update(item, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> },
                    { key: 'actions', label: 'Actions', render: item => <button type="button" className="small" onClick={() => setMessage(`${item.name} is ready to edit inline.`)}>Edit</button> }
                ]}
            />
        </article>
    );
}

function DesignationsPanel({ designations, users, reloadManagement, setMessage, setError }) {
    const [form, setForm] = useState({ name: '', code: '', description: '', hierarchyLevel: 10 });
    const designationStats = useMemo(() => designations.map(designation => {
        const members = users.filter(user => String(user.designationId || '') === String(designation.id) && user.accountType !== 'client');
        const departments = [...new Set(members.map(user => user.departmentName).filter(Boolean))];
        return { ...designation, employeeCount: members.length, departmentLabel: departments.length ? departments.slice(0, 2).join(', ') + (departments.length > 2 ? ` +${departments.length - 2}` : '') : '-' };
    }), [designations, users]);
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
                <button type="submit" form="designation-create-form" className="overview-submit-button"><DashboardIcon name="plus" />Add Designation</button>
            </div>
            <form id="designation-create-form" className="management-form compact" onSubmit={create}>
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
                rows={designationStats}
                columns={[
                    { key: 'name', label: 'Designation', render: item => <b>{item.name}</b> },
                    { key: 'departmentLabel', label: 'Department' },
                    { key: 'hierarchyLevel', label: 'Hierarchy Level', render: item => <input type="number" min="0" max="999" value={item.hierarchyLevel} onChange={event => update(item, { hierarchyLevel: Number(event.target.value) })} /> },
                    { key: 'employeeCount', label: 'Number Employees' },
                    { key: 'status', label: 'Status', render: item => <select value={item.status} onChange={event => update(item, { status: event.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select> },
                    { key: 'actions', label: 'Actions', render: item => <button type="button" className="small" onClick={() => setMessage(`${item.name} is ready to edit inline.`)}>Edit</button> }
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
    const userIds = new Set(users.map(user => user.id));
    const roots = users.filter(user => !user.managerUserId || !userIds.has(user.managerUserId));
    const renderNode = (user, depth = 0) => (
        <div className="hierarchy-node" style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }} key={user.id}>
            <div className="hierarchy-person">
                <span className="dashboard-avatar">{initialsFor(user.name)}</span>
                <div>
                    <b>{user.name}</b>
                    <span>{user.roleName || accountTypeLabel(user.accountType)}</span>
                    <small>{user.designationName || 'No designation'} - {user.departmentName || 'No department'}</small>
                </div>
                <em>{(byManager[user.id] || []).length} direct report{(byManager[user.id] || []).length === 1 ? '' : 's'}</em>
            </div>
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
