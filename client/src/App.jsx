import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, getToken, setToken } from './api';
import { addWorkingHours } from './tat';
import SupportTickets from './SupportTickets';
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
        return _jsx("div", { className: "center", children: error || 'Loading CI360 Job Board...' });
    const tabs = data.user.role === 'admin' ? [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'By Category'], ['settings', 'TAT Standards'], ['clients', 'Manage Clients'], ['support', 'Support Tickets']] : [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'By Category'], ['support', 'Support Tickets']];
    const logout = () => { setToken(null); setAuth(false); setData(null); };
    return _jsxs("main", { className: "app", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsxs("h1", { children: ["CI360", _jsx("span", { children: "degrees" })] }), _jsx("p", { children: "Realtime Job Board" })] }), _jsxs("div", { className: "identity", children: ["Logged in as ", _jsx("b", { children: data.user.name }), _jsx("button", { onClick: logout, children: "Log out" })] })] }), _jsx("nav", { children: tabs.map(([id, label]) => _jsx("button", { className: tab === id ? 'active' : '', onClick: () => setTab(id), children: label }, id)) }), error && _jsx("div", { className: "alert error", children: error }), tab === 'overview' && _jsx(Overview, { data: data }), " ", tab === 'submit' && _jsx(Submit, { data: data, reload: load }), " ", tab === 'jobs' && _jsx(Jobs, { data: data, reload: load }), " ", tab === 'settings' && data.user.role === 'admin' && _jsx(SettingsPanel, { initial: data.settings, reload: load }), " ", tab === 'clients' && data.user.role === 'admin' && _jsx(Clients, { data: data, reload: load }), " ", tab === 'support' && _jsx(SupportTickets, { data: data, reload: load }), " "] });
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
                    _jsxs("div", { className: "auth-story-copy", children: [_jsx("h1", { children: "Work requests, organised beautifully." }), _jsx("p", { children: "Submit jobs, follow turnaround times, collaborate with the CI360 team, and manage your projects from one secure workspace." })] }),
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
    return _jsxs("div", { className: "auth-logo", children: ["CI", _jsx("span", { children: "360" }), "degrees"] });
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
function Overview({ data }) {
    const [client, setClient] = useState('');
    const jobs = client ? data.jobs.filter(job => job.clientId === client) : data.jobs;
    const pendingGroups = groupByMonth(jobs.filter(isPendingJob), job => job.datePosted);
    const completedGroups = groupByMonth(jobs.filter(isCompletedJob), dateForMonth);
    return _jsxs(_Fragment, { children: [
            data.user.role === 'admin' && _jsx("div", { className: "filters overview-filter", children: _jsxs("select", { value: client, onChange: e => setClient(e.target.value), children: [_jsx("option", { value: "", children: "All clients" }), data.clients.map(c => _jsx("option", { value: c.id, children: c.name }, c.id))] }) }),
            _jsx("h3", { className: "section-heading", children: "Pending, by month posted" }),
            _jsx(MonthGroups, { groups: pendingGroups, data: data, empty: "Nothing here yet.", sortDate: job => job.datePosted }),
            _jsx("h3", { className: "section-heading section-heading-spaced", children: "Completed, by month finished" }),
            _jsx(MonthGroups, { groups: completedGroups, data: data, empty: "Nothing completed yet.", sortDate: dateForMonth })
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
} }; return _jsxs("form", { className: "card form", onSubmit: submit, children: [_jsx("h2", { children: "New job request" }), message && _jsx("div", { className: "alert", children: message }), data.user.role === 'admin' && _jsxs("label", { children: ["Client", _jsx("select", { value: form.clientId, onChange: e => setForm({ ...form, clientId: e.target.value }), children: data.clients.filter(c => c.status === 'active').map(c => _jsx("option", { value: c.id, children: c.name }, c.id)) })] }), _jsxs("label", { children: ["Job title", _jsx("input", { required: true, value: form.title, onChange: e => setForm({ ...form, title: e.target.value }) })] }), _jsxs("label", { children: ["Description", _jsx("textarea", { value: form.description, onChange: e => setForm({ ...form, description: e.target.value }) })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category", _jsx("select", { value: form.category, onChange: e => setForm({ ...form, category: e.target.value }), children: data.settings.categories.map(c => _jsx("option", { children: c.name }, c.name)) })] }), _jsxs("label", { children: ["Priority", _jsxs("select", { value: form.priority, onChange: e => setForm({ ...form, priority: e.target.value }), children: [_jsx("option", { children: "Low" }), _jsx("option", { children: "Medium" }), _jsx("option", { children: "High" }), _jsx("option", { children: "Urgent" })] })] })] }), _jsxs("label", { children: ["Asset link", _jsx("input", { value: form.assetLink, onChange: e => setForm({ ...form, assetLink: e.target.value }), placeholder: "Google Drive, Dropbox or another secure URL" })] }), _jsxs("label", { children: ["Posted by", _jsx("input", { required: true, value: form.postedBy, onChange: e => setForm({ ...form, postedBy: e.target.value }) })] }), _jsx("button", { className: "primary", children: "Submit job" })] }); }
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
                    data.user.role === 'admin' && _jsxs("select", { value: client, onChange: e => setClient(e.target.value), children: [_jsx("option", { value: "", children: "All clients" }), data.clients.map(c => _jsx("option", { value: c.id, children: c.name }, c.id))] }),
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
    const effectiveHours = job.teamOverrideHours ?? job.calculatedHours;
    const due = addWorkingHours(new Date(job.datePosted), effectiveHours, data.settings);
    const completed = isCompletedJob(job);
    const teamSet = job.teamOverrideHours != null;
    const overdue = isPendingJob(job) && due < new Date();
    const client = clientNameFor(data, job.clientId);
    const save = async () => { await api.updateJob(job.id, { status, teamOverrideHours: Number(hours), teamOverrideNote: note }); await reload?.(); };
    return _jsxs("article", { className: `job priority-${job.priority} ${completed ? 'completed' : ''}`, children: [
            _jsxs("div", { className: "job-head", children: [
                    _jsxs("div", { children: [_jsx("h3", { children: job.title }), _jsxs("p", { children: ["Posted by ", _jsx("b", { children: job.postedBy }), " on ", fmt(job.datePosted)] })] }),
                    _jsxs("div", { className: "badges", children: [
                            data.user.role === 'admin' && _jsx("span", { className: "badge client", children: client }),
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
            editable && data.user.role === 'admin' && _jsxs("div", { className: "editbar", children: [_jsx("select", { value: status, onChange: e => setStatus(e.target.value), children: Object.entries(statusLabels).map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }), _jsx("input", { type: "number", min: "1", value: hours, onChange: e => setHours(Number(e.target.value)) }), _jsx("input", { value: note, onChange: e => setNote(e.target.value), placeholder: "Team TAT note" }), _jsx("button", { onClick: save, children: "Save" })] })
        ] });
}
function SettingsPanel({ initial, reload }) { const [s, setS] = useState(initial); const save = async () => { await api.saveSettings(s); await reload(); alert('TAT standards saved.'); }; return _jsxs("section", { className: "card", children: [_jsx("h2", { children: "TAT standards" }), s.categories.map((c, i) => _jsxs("div", { className: "setting-row", children: [_jsx("input", { value: c.name, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, name: e.target.value } : x) }) }), _jsx("input", { type: "number", min: "1", value: c.baseHours, onChange: e => setS({ ...s, categories: s.categories.map((x, n) => n === i ? { ...x, baseHours: Number(e.target.value) } : x) }) }), _jsx("button", { onClick: () => setS({ ...s, categories: s.categories.filter((_, n) => n !== i) }), children: "Remove" })] }, i)), _jsx("button", { onClick: () => setS({ ...s, categories: [...s.categories, { name: 'New category', baseHours: 24 }] }), children: "+ Add category" }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category capacity", _jsx("input", { type: "number", value: s.capacityPerCategory, onChange: e => setS({ ...s, capacityPerCategory: Number(e.target.value) }) })] }), _jsxs("label", { children: ["Extra hours over capacity", _jsx("input", { type: "number", value: s.bufferHoursPerExtraJob, onChange: e => setS({ ...s, bufferHoursPerExtraJob: Number(e.target.value) }) })] })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Start hour", _jsx("input", { type: "number", step: "0.5", value: s.startHour, onChange: e => setS({ ...s, startHour: Number(e.target.value) }) })] }), _jsxs("label", { children: ["End hour", _jsx("input", { type: "number", step: "0.5", value: s.endHour, onChange: e => setS({ ...s, endHour: Number(e.target.value) }) })] })] }), _jsx("button", { className: "primary", onClick: save, children: "Save standards" })] }); }
function Clients({ data, reload }) {
    const [form, setForm] = useState({ id: '', name: '', password: '' });
    const [passwords, setPasswords] = useState({});
    const [message, setMessage] = useState('');
    const create = async () => { try {
        await api.createClient(form);
        setForm({ id: '', name: '', password: '' });
        setMessage('Client added.');
        await reload();
    }
    catch (err) {
        setMessage(err.message);
    } };
    const update = async (id, patch) => { await api.updateClient(id, patch); await reload(); };
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
            setMessage(next === 'archived' ? 'Client removed.' : 'Client restored.');
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    return _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Manage clients" }), _jsx("p", { className: "muted", children: "Each client logs in with their own ID and password, and only sees their own jobs." }), message && _jsx("div", { className: "alert", children: message }), _jsx("div", { className: "client-table-wrap", children: _jsxs("table", { className: "client-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Client ID" }), _jsx("th", { children: "Name" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "New Password" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: data.clients.map(c => _jsxs("tr", { children: [_jsx("td", { children: _jsx("b", { children: c.id }) }), _jsx("td", { children: c.name }), _jsx("td", { children: _jsx("span", { className: `status-pill ${c.status}`, children: c.status }) }), _jsx("td", { children: _jsx("input", { type: "password", value: passwords[c.id] || '', onChange: e => setPasswords(current => ({ ...current, [c.id]: e.target.value })), onKeyDown: e => { if (e.key === 'Enter')
                                                resetPassword(c.id); }, placeholder: "minimum 6 characters", "aria-label": `New password for ${c.name}` }) }), _jsx("td", { children: _jsxs("div", { className: "client-actions", children: [_jsx("button", { type: "button", className: "primary small", onClick: () => resetPassword(c.id), children: "Reset Password" }), _jsx("button", { type: "button", className: c.status === 'active' ? 'danger small' : 'small', onClick: () => toggleClient(c.id, c.status), children: c.status === 'active' ? 'Remove' : 'Restore' })] }) })] }, c.id)) })] }) }), _jsx("h3", { children: "Add client" }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Client ID", _jsx("input", { value: form.id, onChange: e => setForm({ ...form, id: e.target.value.toLowerCase() }) })] }), _jsxs("label", { children: ["Name", _jsx("input", { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }) })] }), _jsxs("label", { children: ["Temporary password", _jsx("input", { value: form.password, onChange: e => setForm({ ...form, password: e.target.value }) })] })] }), _jsx("button", { type: "button", className: "primary", onClick: create, children: "+ Add client" })] });
}
