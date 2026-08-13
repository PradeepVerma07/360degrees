import { useState } from 'react';
import { api } from '../api';

const num = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Number(value || 0));

function DashboardEmptyState({ title, body }) {
  return (
    <div className="dashboard-empty">
      <span><svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4H20V20H4V4Z" stroke="#102044" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

export default function ProductivityLogJob({ meta, canCreate, reload }) {
  const [form, setForm] = useState({ clientId: meta.clients[0]?.id || '', startDate: '', completionDate: '', valueAmount: 0, description: '', serviceIds: [], assignments: [{ userId: '', revenuePercent: 100, hoursSpent: 0, responsibilityKey: '' }] });
  const total = form.assignments.reduce((sum, item) => sum + Number(item.revenuePercent || 0), 0);
  const submit = async () => {
    await api.createProductivityJob(form);
    setForm({ clientId: meta.clients[0]?.id || '', startDate: '', completionDate: '', valueAmount: 0, description: '', serviceIds: [], assignments: [{ userId: '', revenuePercent: 100, hoursSpent: 0, responsibilityKey: '' }] });
    await reload('Productivity job logged.');
  };
  if (!canCreate)
    return <DashboardEmptyState title="No job logging access." body="Ask a Super Admin to grant productivity job creation permission." />;
  return (
    <article className="dashboard-card productivity-card productivity-wide">
      <div className="dashboard-card-head"><h3>Log a Job</h3><p>{total === 100 ? '100% of revenue allocated.' : `${num(total)}% allocated - should total 100%.`}</p></div>
      <div className="productivity-log-grid">
        <select aria-label="Client" value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}>{meta.clients.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
        <input aria-label="Start date" type="date" min={meta.tracking?.start} max={meta.tracking?.end} value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        <input aria-label="Completion date" type="date" min={meta.tracking?.start} max={meta.tracking?.end} value={form.completionDate} onChange={e => setForm({ ...form, completionDate: e.target.value })} />
        <input aria-label="Job value" type="number" min="0" value={form.valueAmount} onChange={e => setForm({ ...form, valueAmount: Number(e.target.value) })} placeholder="Job value" />
        <textarea aria-label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" />
        <div className="productivity-checks">{meta.services.map(s => <label className="permission-check" key={s.id}><input type="checkbox" aria-label={`Service ${s.name}`} checked={form.serviceIds.includes(s.id)} onChange={e => setForm({ ...form, serviceIds: e.target.checked ? [...form.serviceIds, s.id] : form.serviceIds.filter(id => id !== s.id) })} />{s.name}</label>)}</div>
      </div>
      <div className="productivity-stack">
        {form.assignments.map((assignment, index) => <div className="productivity-form-row" key={index}>
          <select aria-label="Employee" value={assignment.userId} onChange={e => setForm({ ...form, assignments: form.assignments.map((a, i) => i === index ? { ...a, userId: e.target.value } : a) })}><option value="">Employee</option>{meta.employees.map(e => <option value={e.id} key={e.id}>{e.name} - {e.duties}</option>)}</select>
          <select aria-label="Role" value={assignment.responsibilityKey || ''} onChange={e => setForm({ ...form, assignments: form.assignments.map((a, i) => i === index ? { ...a, responsibilityKey: e.target.value } : a) })}>
            <option value="">Role</option>
            { (meta.responsibilities || []).map(r => <option value={r.key} key={r.key}>{r.label}</option>) }
          </select>
          <input aria-label="Revenue percent" type="number" min="0" max="100" value={assignment.revenuePercent} onChange={e => setForm({ ...form, assignments: form.assignments.map((a, i) => i === index ? { ...a, revenuePercent: Number(e.target.value) } : a) })} />
          <input aria-label="Hours spent" type="number" min="0" value={assignment.hoursSpent} onChange={e => setForm({ ...form, assignments: form.assignments.map((a, i) => i === index ? { ...a, hoursSpent: Number(e.target.value) } : a) })} />
          <button aria-label="Remove person" type="button" onClick={() => setForm({ ...form, assignments: form.assignments.filter((_, i) => i !== index) })}>Remove</button>
        </div>)}
        <button aria-label="Add person" type="button" onClick={() => setForm({ ...form, assignments: [...form.assignments, { userId: '', revenuePercent: 0, hoursSpent: 0, responsibilityKey: '' }] })}>+ Add Person</button>
        <button className="primary" aria-label="Save productivity job" disabled={!form.clientId || !form.startDate || !form.serviceIds.length || total !== 100} onClick={submit}>Save Productivity Job</button>
      </div>
    </article>
  );
}
