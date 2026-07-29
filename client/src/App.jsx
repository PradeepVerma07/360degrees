import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, setToken } from './api';
import { addWorkingHours } from './tat';
import SupportTickets from './SupportTickets';
import './styles.css';
const statusLabels = { submitted: 'Submitted', under_review: 'Under Review', in_progress: 'In Progress', waiting_client: 'Waiting for Client', revision_requested: 'Revision Requested', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled' };
const fmt = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export default function App() {
    const [auth, setAuth] = useState(Boolean(localStorage.getItem('ci360-token')));
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
    const tabs = data.user.role === 'admin' ? [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'All Jobs'], ['settings', 'TAT Standards'], ['clients', 'Manage Clients'], ['support', 'Support Tickets']] : [['overview', 'Overview'], ['submit', 'Submit a Job'], ['jobs', 'My Jobs'], ['support', 'Support Tickets']];
    const logout = () => { setToken(null); setAuth(false); setData(null); };
    return _jsxs("main", { className: "app", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsxs("h1", { children: ["CI360", _jsx("span", { children: "degrees" })] }), _jsx("p", { children: "Realtime Job Board" })] }), _jsxs("div", { className: "identity", children: ["Logged in as ", _jsx("b", { children: data.user.name }), _jsx("button", { onClick: logout, children: "Log out" })] })] }), _jsx("nav", { children: tabs.map(([id, label]) => _jsx("button", { className: tab === id ? 'active' : '', onClick: () => setTab(id), children: label }, id)) }), error && _jsx("div", { className: "alert error", children: error }), tab === 'overview' && _jsx(Overview, { data: data }), " ", tab === 'submit' && _jsx(Submit, { data: data, reload: load }), " ", tab === 'jobs' && _jsx(Jobs, { data: data, reload: load }), " ", tab === 'settings' && data.user.role === 'admin' && _jsx(SettingsPanel, { initial: data.settings, reload: load }), " ", tab === 'clients' && data.user.role === 'admin' && _jsx(Clients, { data: data, reload: load }), " ", tab === 'support' && _jsx(SupportTickets, { data: data, reload: load }), " "] });
}
function Login({ onLogin }) { const [id, setId] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const submit = async (e) => { e.preventDefault(); try {
    const r = await api.login(id, password);
    setToken(r.token);
    onLogin();
}
catch (err) {
    setError(err.message);
} }; return _jsx("div", { className: "login-shell", children: _jsxs("form", { className: "login-card", onSubmit: submit, children: [_jsxs("h1", { children: ["CI360", _jsx("span", { children: "degrees" })] }), _jsx("p", { children: "Job Board Sign In" }), _jsxs("label", { children: ["ID", _jsx("input", { value: id, onChange: e => setId(e.target.value), autoComplete: "username" })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), autoComplete: "current-password" })] }), error && _jsx("div", { className: "alert error", children: error }), _jsx("button", { className: "primary", children: "Log in" }), _jsx("small", { children: "Demo admin: ci360admin / CI360Demo#2026" })] }) }); }
function Overview({ data }) { const pending = data.jobs.filter(j => !['completed', 'cancelled'].includes(j.status)); const complete = data.jobs.filter(j => j.status === 'completed'); return _jsxs(_Fragment, { children: [_jsxs("section", { className: "metrics", children: [_jsx(Metric, { label: "Active jobs", value: pending.length }), _jsx(Metric, { label: "Completed", value: complete.length }), _jsx(Metric, { label: "Urgent", value: pending.filter(j => j.priority === 'Urgent').length }), _jsx(Metric, { label: "Clients", value: data.user.role === 'admin' ? data.clients.filter(c => c.status === 'active').length : 1 })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Current workload" }), _jsx("div", { className: "load-grid", children: data.settings.categories.map(c => { const count = data.categoryLoad[c.name] || 0; const pct = Math.min(100, count / Math.max(1, data.settings.capacityPerCategory) * 100); return _jsxs("div", { className: "load", children: [_jsx("b", { children: c.name }), _jsx("div", { className: "meter", children: _jsx("i", { style: { width: pct + '%' } }) }), _jsxs("span", { children: [count, " active / capacity ", data.settings.capacityPerCategory] })] }, c.name); }) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Recently updated" }), _jsx("div", { className: "jobs", children: data.jobs.slice(0, 6).map(j => _jsx(JobCard, { job: j, data: data }, j.id)) })] })] }); }
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
function Jobs({ data, reload }) { const [category, setCategory] = useState(''); const [priority, setPriority] = useState(''); const [status, setStatus] = useState(''); const [client, setClient] = useState(''); const filtered = useMemo(() => data.jobs.filter(j => (!category || j.category === category) && (!priority || j.priority === priority) && (!status || j.status === status) && (!client || j.clientId === client)), [data.jobs, category, priority, status, client]); return _jsxs(_Fragment, { children: [_jsxs("div", { className: "filters", children: [_jsxs("select", { value: category, onChange: e => setCategory(e.target.value), children: [_jsx("option", { value: "", children: "All categories" }), data.settings.categories.map(c => _jsx("option", { children: c.name }, c.name))] }), _jsxs("select", { value: priority, onChange: e => setPriority(e.target.value), children: [_jsx("option", { value: "", children: "All priorities" }), ['Urgent', 'High', 'Medium', 'Low'].map(p => _jsx("option", { children: p }, p))] }), _jsxs("select", { value: status, onChange: e => setStatus(e.target.value), children: [_jsx("option", { value: "", children: "All statuses" }), Object.entries(statusLabels).map(([v, l]) => _jsx("option", { value: v, children: l }, v))] }), data.user.role === 'admin' && _jsxs("select", { value: client, onChange: e => setClient(e.target.value), children: [_jsx("option", { value: "", children: "All clients" }), data.clients.map(c => _jsx("option", { value: c.id, children: c.name }, c.id))] })] }), _jsx("div", { className: "jobs", children: filtered.map(j => _jsx(JobCard, { job: j, data: data, editable: true, reload: reload }, j.id)) })] }); }
function JobCard({ job, data, editable = false, reload }) { const [status, setStatus] = useState(job.status); const [hours, setHours] = useState(job.teamOverrideHours ?? job.calculatedHours); const [note, setNote] = useState(job.teamOverrideNote); const due = addWorkingHours(new Date(job.datePosted), job.teamOverrideHours ?? job.calculatedHours, data.settings); const client = data.clients.find(c => c.id === job.clientId)?.name || job.clientId; const save = async () => { await api.updateJob(job.id, { status, teamOverrideHours: Number(hours), teamOverrideNote: note }); await reload?.(); }; return _jsxs("article", { className: `job priority-${job.priority}`, children: [_jsxs("div", { className: "job-head", children: [_jsxs("div", { children: [_jsx("h3", { children: job.title }), _jsxs("p", { children: ["Posted by ", _jsx("b", { children: job.postedBy }), " on ", fmt(job.datePosted)] })] }), _jsxs("div", { className: "badges", children: [data.user.role === 'admin' && _jsx("span", { className: "badge client", children: client }), _jsx("span", { className: "badge category", children: job.category }), _jsx("span", { className: `badge ${job.priority}`, children: job.priority }), _jsx("span", { className: "badge status", children: statusLabels[job.status] })] })] }), job.description && _jsx("p", { className: "description", children: job.description }), job.assetLink && _jsx("a", { href: job.assetLink, target: "_blank", rel: "noreferrer", children: "View assets \u2197" }), _jsxs("p", { className: "due", children: ["TAT: ", _jsxs("b", { children: [job.teamOverrideHours ?? job.calculatedHours, " working hours"] }), " \u00B7 due ", fmt(due)] }), editable && data.user.role === 'admin' && _jsxs("div", { className: "editbar", children: [_jsx("select", { value: status, onChange: e => setStatus(e.target.value), children: Object.entries(statusLabels).map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }), _jsx("input", { type: "number", min: "1", value: hours, onChange: e => setHours(Number(e.target.value)) }), _jsx("input", { value: note, onChange: e => setNote(e.target.value), placeholder: "Team TAT note" }), _jsx("button", { onClick: save, children: "Save" })] })] }); }
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
