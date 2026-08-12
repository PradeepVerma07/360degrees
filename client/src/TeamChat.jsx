import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const fmt = value => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const can = (data, permission) => (data.permissions || data.user?.permissions || []).includes(permission);

export default function TeamChat({ data, reload }) {
  const canCreate = can(data, 'chat.create');
  const canReply = can(data, 'chat.reply');
  const departments = data.departments || [];
  const chatEmployees = useMemo(
    () => (data.chatEmployees || data.assignees || []).filter(employee => employee.id !== data.user?.id),
    [data.chatEmployees, data.assignees, data.user?.id]
  );
  const threads = useMemo(() => data.chatThreads || [], [data.chatThreads]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: '', departmentId: data.user?.departmentId || '', participantUserId: '', body: '' });
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const selectedRef = useRef(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selected?.id) return;
    const threadId = selected.id;
    let active = true;
    let inFlight = false;
    const refreshThread = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result = await api.getInternalChatThread(threadId);
        if (!active || selectedRef.current?.id !== threadId) return;
        const current = selectedRef.current;
        const currentLast = current.messages?.[current.messages.length - 1]?.id;
        const nextLast = result.thread.messages?.[result.thread.messages.length - 1]?.id;
        if (current.updatedAt !== result.thread.updatedAt || currentLast !== nextLast || current.messages?.length !== result.thread.messages?.length) {
          setSelected(result.thread);
          await reload();
        }
      } catch (_error) {
        // Keep the open chat usable during brief refresh failures.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(refreshThread, 5000);
    window.addEventListener('focus', refreshThread);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshThread);
    };
  }, [selected?.id, reload]);

  const openThread = async id => {
    setError('');
    try {
      const result = await api.getInternalChatThread(id);
      setSelected(result.thread);
      setReply('');
    } catch (err) {
      setError(err.message);
    }
  };

  const directEmployeeName = thread => {
    if (!thread.participantUserId) return '';
    return thread.participantUserId === data.user?.id
      ? (thread.createdByName || 'Team member')
      : (thread.participantName || 'Employee');
  };

  const audienceLabel = thread => {
    const directName = directEmployeeName(thread);
    if (directName) return `Direct with ${directName}`;
    return thread.departmentName || 'All internal team';
  };

  const createThread = async event => {
    event.preventDefault();
    setError('');
    try {
      const result = await api.createInternalChatThread(form);
      setSelected(result.thread);
      setShowForm(false);
      setForm({ subject: '', departmentId: data.user?.departmentId || '', participantUserId: '', body: '' });
      setToast('Chat thread created.');
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setError('');
    try {
      const result = await api.replyInternalChatThread(selected.id, reply.trim());
      setSelected(result.thread);
      setReply('');
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="team-chat-page">
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="page-title">
        <div>
          <h2>Team Chat</h2>
          <p className="muted">Internal employee conversations for departments and team coordination.</p>
        </div>
        {canCreate && <button type="button" className="primary" onClick={() => setShowForm(true)}>+ New Chat</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {selected ? (
        <section className="card ticket-detail ticket-detail-page">
          <div className="modal-head ticket-detail-head">
            <div>
              <button type="button" className="small ticket-back" onClick={() => setSelected(null)}>&lt; Back to Chat</button>
              <h2>{selected.subject}</h2>
              <p className="muted">{audienceLabel(selected)} - Started by {selected.createdByName || 'Team member'}</p>
            </div>
          </div>
          <div className="conversation">
            {(selected.messages || []).map(message => (
              <article className={`message ${message.authorId === data.user?.id ? 'admin' : 'client'}`} key={message.id}>
                <div className="message-head">
                  <b>{message.authorName}</b>
                  <span>{selected.participantUserId ? 'Direct message' : 'Team message'} - {fmt(message.createdAt)}</span>
                </div>
                <p>{message.body}</p>
              </article>
            ))}
          </div>
          {canReply && (
            <div className="reply-box">
              <div className="reply-composer">
                <div className="reply-composer-head">
                  <div>
                    <h3>Send a message</h3>
                    <p className="muted">This stays inside the employee workspace.</p>
                  </div>
                </div>
                <label className="reply-field">
                  <span>Message</span>
                  <textarea value={reply} onChange={event => setReply(event.target.value)} rows={5} placeholder="Write an internal update..." />
                </label>
                <div className="reply-actions">
                  <span>Only internal users with chat access can see this thread.</span>
                  <button type="button" className="primary" onClick={sendReply} disabled={!reply.trim()}>Send Message</button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : threads.length ? (
        <div className="card table-card ticket-list-card">
          <div className="responsive-table">
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Audience</th>
                  <th>Started By</th>
                  <th>Last Message</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {threads.map(thread => (
                  <tr key={thread.id}>
                    <td data-label="Subject"><b>{thread.subject}</b><small>{thread.lastMessage || 'No message preview'}</small></td>
                    <td data-label="Audience">{audienceLabel(thread)}</td>
                    <td data-label="Started By">{thread.createdByName || '-'}</td>
                    <td data-label="Last Message">{fmt(thread.lastMessageAt)}</td>
                    <td data-label="Action"><button type="button" className="small" onClick={() => openThread(thread.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card empty-state">
          <h3>No internal chats yet.</h3>
          {canCreate && <button type="button" className="primary" onClick={() => setShowForm(true)}>Start Team Chat</button>}
        </div>
      )}
      {showForm && canCreate && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-chat-title">
          <form className="modal-panel ticket-form" onSubmit={createThread}>
            <div className="modal-head">
              <div>
                <h2 id="new-chat-title">New Team Chat</h2>
                <p className="muted">Start an internal conversation with one employee or a team group.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close chat form" onClick={() => setShowForm(false)}>x</button>
            </div>
            <label>Subject
              <input required value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} />
            </label>
            <label>Employee
              <select
                value={form.participantUserId || ''}
                onChange={event => {
                  const participantUserId = event.target.value;
                  setForm({
                    ...form,
                    participantUserId,
                    departmentId: participantUserId ? '' : (form.departmentId || data.user?.departmentId || '')
                  });
                }}
              >
                <option value="">Team or department chat</option>
                {chatEmployees.map(employee => (
                  <option value={employee.id} key={employee.id}>
                    {employee.name}{employee.departmentName ? ` - ${employee.departmentName}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {!form.participantUserId && (
              <label>Department
                <select value={form.departmentId || ''} onChange={event => setForm({ ...form, departmentId: event.target.value })}>
                  <option value="">All internal team</option>
                  {departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}
                </select>
              </label>
            )}
            <label>Message
              <textarea required value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="primary">Create Chat</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
