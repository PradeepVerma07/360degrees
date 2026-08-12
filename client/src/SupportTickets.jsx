import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const categories = [
  'Technical Issue',
  'Account Issue',
  'Job Posting Issue',
  'Candidate Issue',
  'Client Issue',
  'Billing Issue',
  'Feature Request',
  'General Support'
];
const priorities = ['Low', 'Medium', 'High', 'Urgent'];
const statuses = ['Open', 'In Progress', 'Waiting for User', 'Resolved', 'Closed'];
const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'zip']);
const maxAttachmentBytes = 10 * 1024 * 1024;
const fmt = value => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const can = (data, permission) => (data.permissions || data.user?.permissions || []).includes(permission);
const scrollDashboardToTop = () => {
  window.requestAnimationFrame(() => {
    document.querySelector('.dashboard-main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
};

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function attachmentPayload(file) {
  if (!file) return null;
  if (file.size > maxAttachmentBytes) throw new Error('Attachment must be 10 MB or smaller.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!allowedExtensions.has(extension)) throw new Error('Attachment must be PDF, DOC, DOCX, JPG, JPEG, PNG or ZIP.');
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    data: bytesToBase64(new Uint8Array(buffer))
  };
}

export default function SupportTickets({ data, reload, openCreateSignal = 0 }) {
  const isAdmin = can(data, 'support.manage') || can(data, 'support.view_all');
  const isClient = data.user?.accountType === 'client';
  const canCreateTicket = can(data, 'support.create');
  const canReplyTicket = can(data, 'support.reply');
  const canManageTickets = can(data, 'support.manage');
  const canAssignTickets = can(data, 'support.assign') || canManageTickets || isAdmin;
  const canDeleteTickets = canManageTickets || (isClient && can(data, 'support.view_own'));
  const departments = data.departments || [];
  const assignees = data.assignees || [];
  const clientJobs = useMemo(() => (data.jobs || []).filter(job => !['completed', 'cancelled'].includes(job.status)), [data.jobs]);
  const tickets = useMemo(() => data.supportTickets || [], [data.supportTickets]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: '', jobId: '', category: 'Technical Issue', priority: 'Medium', description: '' });
  const [attachment, setAttachment] = useState(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedTicketNumbers, setSelectedTicketNumbers] = useState([]);
  const [loadingTicket, setLoadingTicket] = useState('');
  const [reply, setReply] = useState('');
  const [detailError, setDetailError] = useState('');
  const selectedRef = useRef(null);
  const selectedTicketSet = useMemo(() => new Set(selectedTicketNumbers), [selectedTicketNumbers]);
  const selectedTicketSummary = useMemo(() => selected ? tickets.find(ticket => ticket.ticketNumber === selected.ticketNumber) : null, [tickets, selected?.ticketNumber]);
  const allTicketsSelected = tickets.length > 0 && tickets.every(ticket => selectedTicketSet.has(ticket.ticketNumber));

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const liveTicketNumbers = new Set(tickets.map(ticket => ticket.ticketNumber));
    setSelectedTicketNumbers(current => {
      const next = current.filter(ticketNumber => liveTicketNumbers.has(ticketNumber));
      return next.length === current.length ? current : next;
    });
  }, [tickets]);

  useEffect(() => {
    if (!openCreateSignal) return;
    setSelected(null);
    setShowForm(true);
    scrollDashboardToTop();
  }, [openCreateSignal]);

  useEffect(() => {
    if (!selected || !selectedTicketSummary || selectedTicketSummary.updatedAt === selected.updatedAt) return;
    let active = true;
    api.getSupportTicket(selected.ticketNumber)
      .then(result => {
        if (!active) return;
        setSelected(current => current?.ticketNumber === result.ticket.ticketNumber ? result.ticket : current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selected?.ticketNumber, selected?.updatedAt, selectedTicketSummary?.updatedAt]);

  useEffect(() => {
    if (!selected?.ticketNumber) return;
    const ticketNumber = selected.ticketNumber;
    let active = true;
    let inFlight = false;
    const refreshTicket = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result = await api.getSupportTicket(ticketNumber);
        if (!active) return;
        const current = selectedRef.current;
        if (!current || current.ticketNumber !== ticketNumber) return;
        const currentLastMessage = current.messages?.[current.messages.length - 1]?.id;
        const nextLastMessage = result.ticket.messages?.[result.ticket.messages.length - 1]?.id;
        const changed = current.updatedAt !== result.ticket.updatedAt
          || current.status !== result.ticket.status
          || currentLastMessage !== nextLastMessage
          || (current.messages?.length ?? 0) !== (result.ticket.messages?.length ?? 0);
        if (changed) {
          setSelected(result.ticket);
          await reload();
        }
      } catch (_error) {
        // Keep the open conversation usable if a background refresh briefly fails.
      } finally {
        inFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshTicket();
    };
    const timer = window.setInterval(refreshTicket, 6000);
    window.addEventListener('focus', refreshTicket);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshTicket);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selected?.ticketNumber, reload]);

  const resetForm = () => {
    setForm({ subject: '', jobId: '', category: 'Technical Issue', priority: 'Medium', description: '' });
    setAttachment(null);
    setFormError('');
  };

  const submitTicket = async event => {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const file = await attachmentPayload(attachment);
      const result = await api.createSupportTicket({ ...form, attachment: file });
      resetForm();
      setShowForm(false);
      setToast(`Ticket ${result.ticket.ticketNumber} submitted successfully.`);
      await reload();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openTicket = async ticketNumber => {
    setLoadingTicket(ticketNumber);
    setDetailError('');
    setShowForm(false);
    try {
      const result = await api.getSupportTicket(ticketNumber);
      setSelected(result.ticket);
      setReply('');
      scrollDashboardToTop();
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setLoadingTicket('');
    }
  };

  const updateTicket = async patch => {
    if (!selected) return;
    setDetailError('');
    try {
      const result = await api.updateSupportTicket(selected.ticketNumber, patch);
      setSelected(result.ticket);
      setToast('Ticket updated.');
      await reload();
    } catch (error) {
      setDetailError(error.message);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setDetailError('');
    try {
      const result = await api.replySupportTicket(selected.ticketNumber, reply.trim());
      setSelected(result.ticket);
      setReply('');
      setToast('Reply sent.');
      await reload();
    } catch (error) {
      setDetailError(error.message);
    }
  };

  const clearChat = async () => {
    if (!selected) return;
    if (!window.confirm('Clear all messages and attachments from this ticket?')) return;
    setDetailError('');
    try {
      const result = await api.clearSupportTicketMessages(selected.ticketNumber);
      setSelected(result.ticket);
      setReply('');
      setToast('Chat cleared.');
      await reload();
    } catch (error) {
      setDetailError(error.message);
    }
  };

  const deleteTicket = async ticketNumber => {
    if (!window.confirm('Delete this support ticket permanently?')) return;
    setDetailError('');
    try {
      await api.deleteSupportTicket(ticketNumber);
      if (selected?.ticketNumber === ticketNumber) setSelected(null);
      setSelectedTicketNumbers(current => current.filter(value => value !== ticketNumber));
      setToast('Ticket deleted.');
      await reload();
    } catch (error) {
      setDetailError(error.message);
    }
  };

  const deleteSelectedTickets = async () => {
    if (!selectedTicketNumbers.length) return;
    if (!window.confirm(`Delete ${selectedTicketNumbers.length} selected ticket${selectedTicketNumbers.length === 1 ? '' : 's'} permanently?`)) return;
    setDetailError('');
    try {
      const result = await api.deleteSupportTickets(selectedTicketNumbers);
      if (selected && selectedTicketNumbers.includes(selected.ticketNumber)) setSelected(null);
      setSelectedTicketNumbers([]);
      setToast(`${result.deleted} ticket${result.deleted === 1 ? '' : 's'} deleted.`);
      await reload();
    } catch (error) {
      setDetailError(error.message);
    }
  };

  const downloadAttachment = async (ticketNumber, id, fileName) => {
    try {
      await api.downloadTicketAttachment(ticketNumber, id, fileName);
    } catch (error) {
      setDetailError(error.message);
    }
  };

  return (
    <section className={`support-page ${selected ? 'ticket-open' : ''}`}>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="page-title">
        <div>
          <h2>{isAdmin ? 'Support Tickets' : 'My Support Tickets'}</h2>
          <p className="muted">{isAdmin ? 'Assign tickets by department and employee, then keep every conversation in one place.' : isClient ? 'Raise separate tickets for different jobs and track every support conversation.' : 'Reply to client ticket chats assigned to you.'}</p>
        </div>
        {canCreateTicket && isClient && <button type="button" className="primary" onClick={() => setShowForm(true)}>+ Raise Ticket</button>}
      </div>

      {detailError && !selected && <div className="alert error">{detailError}</div>}
      {selected ? (
        <TicketDetail
          ticket={selected}
          isAdmin={isAdmin}
          reply={reply}
          detailError={detailError}
          setReply={setReply}
          onClose={() => {
            setSelected(null);
            setDetailError('');
            scrollDashboardToTop();
          }}
          onReply={sendReply}
          onUpdate={updateTicket}
          onDownload={downloadAttachment}
          onClearChat={clearChat}
          onDeleteTicket={deleteTicket}
          canDelete={canDeleteTickets}
          canReply={canReplyTicket}
          canManage={canManageTickets}
          canAssign={canAssignTickets}
          departments={departments}
          assignees={assignees}
        />
      ) : tickets.length === 0 ? (
        <div className="card empty-state">
          <h3>No support tickets found.</h3>
          {canCreateTicket && isClient && <button type="button" className="primary" onClick={() => setShowForm(true)}>Raise Your First Ticket</button>}
        </div>
      ) : (
        <TicketTable
          tickets={tickets}
          isAdmin={isAdmin}
          loadingTicket={loadingTicket}
          selectedTicketSet={selectedTicketSet}
          allTicketsSelected={allTicketsSelected}
          onToggleTicket={ticketNumber => setSelectedTicketNumbers(current => current.includes(ticketNumber) ? current.filter(value => value !== ticketNumber) : [...current, ticketNumber])}
          onToggleAll={() => setSelectedTicketNumbers(allTicketsSelected ? [] : tickets.map(ticket => ticket.ticketNumber))}
          onDeleteSelected={deleteSelectedTickets}
          onDeleteOne={deleteTicket}
          onView={openTicket}
          canDelete={canDeleteTickets}
        />
      )}

      {showForm && canCreateTicket && isClient && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="raise-ticket-title">
          <form className="modal-panel ticket-form" onSubmit={submitTicket}>
            <div className="modal-head">
              <div>
                <h2 id="raise-ticket-title">Raise Support Ticket</h2>
                <p className="muted">Share the issue details and the support team will follow up here.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close ticket form" onClick={() => { resetForm(); setShowForm(false); }}>x</button>
            </div>
            {formError && <div className="alert error">{formError}</div>}
            <label>Subject
              <input required value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} />
            </label>
            <label>Related Job
              <select value={form.jobId} onChange={event => setForm({ ...form, jobId: event.target.value })}>
                <option value="">General support ticket</option>
                {clientJobs.map(job => <option value={job.id} key={job.id}>{job.title} - {job.statusLabel || job.status}</option>)}
              </select>
            </label>
            <div className="row">
              <label>Category
                <select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
                  {categories.map(category => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label>Priority
                <select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>
                  {priorities.map(priority => <option key={priority}>{priority}</option>)}
                </select>
              </label>
            </div>
            <label>Description
              <textarea required value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
            </label>
            <label>Attachment
              <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.zip" onChange={event => setAttachment(event.target.files?.[0] || null)} />
            </label>
            <p className="field-note">Allowed: PDF, DOC, DOCX, JPG, JPEG, PNG, ZIP. Maximum size: 10 MB.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</button>
              <button type="submit" className="primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Ticket'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function TicketTable({ tickets, isAdmin, loadingTicket, selectedTicketSet, allTicketsSelected, onToggleTicket, onToggleAll, onDeleteSelected, onDeleteOne, onView, canDelete }) {
  return (
    <div className="card table-card ticket-list-card">
      <div className="ticket-toolbar">
        <div>
          <b>{selectedTicketSet.size ? `${selectedTicketSet.size} selected` : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}</b>
          <span>Select tickets to delete multiple chats at once.</span>
        </div>
        {canDelete && <button type="button" className="danger small" onClick={onDeleteSelected} disabled={!selectedTicketSet.size}>Delete Selected</button>}
      </div>
      <div className="responsive-table">
        <table className="ticket-table">
          <thead>
            <tr>
              <th className="select-col">
                <input className="ticket-check" type="checkbox" checked={allTicketsSelected} onChange={onToggleAll} aria-label="Select all tickets" />
              </th>
              <th>Ticket ID</th>
              {isAdmin && <th>User</th>}
              <th>Subject</th>
              <th>Job</th>
              <th>Assigned</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Created Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map(ticket => (
              <tr key={ticket.ticketNumber}>
                <td className="select-col" data-label="Select">
                  <input
                    className="ticket-check"
                    type="checkbox"
                    checked={selectedTicketSet.has(ticket.ticketNumber)}
                    onChange={() => onToggleTicket(ticket.ticketNumber)}
                    aria-label={`Select ticket ${ticket.ticketNumber}`}
                  />
                </td>
                <td data-label="Ticket ID"><b>{ticket.ticketNumber}</b></td>
                {isAdmin && <td data-label="User">{ticket.userName}</td>}
                <td data-label="Subject">{ticket.subject}</td>
                <td data-label="Job">{ticket.jobTitle || 'General'}</td>
                <td data-label="Assigned">{ticket.assignedToName || ticket.departmentName || 'Unassigned'}</td>
                <td data-label="Category">{ticket.category}</td>
                <td data-label="Priority"><span className={`priority-badge priority-${slug(ticket.priority)}`}>{ticket.priority}</span></td>
                <td data-label="Status"><StatusBadge status={ticket.status} /></td>
                <td data-label="Created Date">{fmt(ticket.createdAt)}</td>
                <td data-label="Action">
                  <div className="ticket-row-actions">
                    <button type="button" className="small" onClick={() => onView(ticket.ticketNumber)}>{loadingTicket === ticket.ticketNumber ? 'Opening...' : 'View'}</button>
                    {canDelete && <button type="button" className="danger small" onClick={() => onDeleteOne(ticket.ticketNumber)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TicketDetail({ ticket, isAdmin, reply, detailError, setReply, onClose, onReply, onUpdate, onDownload, onClearChat, onDeleteTicket, canDelete, canReply, canManage, canAssign, departments, assignees }) {
  const closed = ticket.status === 'Closed';
  const messages = ticket.messages || [];
  const attachments = ticket.attachments || [];
  const scopedAssignees = ticket.departmentId
    ? assignees.filter(user => !user.departmentId || Number(user.departmentId) === Number(ticket.departmentId))
    : assignees;
  return (
    <section className="card ticket-detail ticket-detail-page" role="region" aria-labelledby="ticket-detail-title">
      <div className="modal-head ticket-detail-head">
        <div>
          <button type="button" className="small ticket-back" onClick={onClose}>&lt; Back to Tickets</button>
          <h2 id="ticket-detail-title">{ticket.ticketNumber}</h2>
          <p className="muted">{ticket.subject}</p>
        </div>
        <div className="ticket-detail-actions">
          {canManage && <button type="button" className="small" onClick={onClearChat}>Clear Chat</button>}
          {canDelete && <button type="button" className="danger small" onClick={() => onDeleteTicket(ticket.ticketNumber)}>Delete</button>}
          <button type="button" className="icon-button" aria-label="Close ticket detail" onClick={onClose}>x</button>
        </div>
      </div>
      {detailError && <div className="alert error">{detailError}</div>}
      <div className="ticket-meta">
        <div><span>Category</span><b>{ticket.category}</b></div>
        <div><span>Priority</span><b>{ticket.priority}</b></div>
        <div><span>Status</span><StatusBadge status={ticket.status} /></div>
        <div><span>Related job</span><b>{ticket.jobTitle || 'General support'}</b></div>
        <div><span>Department</span><b>{ticket.departmentName || 'No department'}</b></div>
        <div><span>Assigned employee</span><b>{ticket.assignedToName || 'Unassigned'}</b></div>
        <div><span>Created date</span><b>{fmt(ticket.createdAt)}</b></div>
        {isAdmin && <div><span>User</span><b>{ticket.userName}</b></div>}
      </div>
      {(canManage || canAssign) && (
        <div className="admin-ticket-controls">
          {canManage && <label>Status
              <select value={ticket.status} onChange={event => onUpdate({ status: event.target.value })}>
                {statuses.map(status => <option key={status}>{status}</option>)}
              </select>
            </label>}
          {canManage && <label>Priority
              <select value={ticket.priority} onChange={event => onUpdate({ priority: event.target.value })}>
                {priorities.map(priority => <option key={priority}>{priority}</option>)}
              </select>
            </label>}
          {canAssign && <label>Department
              <select value={ticket.departmentId || ''} onChange={event => onUpdate({ departmentId: event.target.value, assignedToUserId: '' })}>
                <option value="">No department</option>
                {departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}
              </select>
            </label>}
          {canAssign && <label>Assign Employee
              <select value={ticket.assignedToUserId || ''} onChange={event => onUpdate({ assignedToUserId: event.target.value })}>
                <option value="">Unassigned</option>
                {scopedAssignees.map(user => <option value={user.id} key={user.id}>{[user.name, user.designationName || user.roleName, user.departmentName].filter(Boolean).join(' - ')}</option>)}
              </select>
            </label>}
          {canAssign && <label>Assignment Note
              <input defaultValue={ticket.assignmentNote || ''} onBlur={event => {
                if (event.target.value !== (ticket.assignmentNote || '')) onUpdate({ assignmentNote: event.target.value });
              }} placeholder="Optional note for employee" />
            </label>}
          {canManage && <button type="button" className="danger" onClick={() => onUpdate({ status: 'Closed' })} disabled={closed}>Close Ticket</button>}
        </div>
      )}
      <h3>Complete conversation</h3>
      {messages.length === 0 ? (
        <div className="empty-conversation">
          <b>No chat messages.</b>
          <p>This ticket chat has been cleared. New replies will appear here.</p>
        </div>
      ) : (
        <div className="conversation">
          {messages.map(message => (
            <article className={`message ${message.authorRole === 'client' ? 'client' : 'admin'}`} key={message.id}>
              <div className="message-head">
                <b>{message.authorName}</b>
                <span>{message.authorRole === 'client' ? 'User reply' : 'Team reply'} - {fmt(message.createdAt)}</span>
              </div>
              <p>{message.body}</p>
              {message.attachments?.length > 0 && (
                <div className="attachment-list">
                  {message.attachments.map(attachment => (
                    <button type="button" className="attachment-chip" onClick={() => onDownload(ticket.ticketNumber, attachment.id, attachment.fileName)} key={attachment.id}>{attachment.fileName}</button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <>
          <h3>Attachments</h3>
          <div className="attachment-list">
            {attachments.map(attachment => (
              <button type="button" className="attachment-chip" onClick={() => onDownload(ticket.ticketNumber, attachment.id, attachment.fileName)} key={attachment.id}>{attachment.fileName}</button>
            ))}
          </div>
        </>
      )}
      <div className="reply-box">
        {closed ? (
          <div className="alert">This ticket has been closed.</div>
        ) : !canReply ? (
          <div className="alert">You can view this conversation but do not have permission to reply.</div>
        ) : (
          <div className="reply-composer">
            <div className="reply-composer-head">
              <div>
                <h3>Send a reply</h3>
                <p className="muted">Keep the conversation moving with a clear update.</p>
              </div>
              <span>{reply.trim().length} characters</span>
            </div>
            <label className="reply-field">
              <span>Message</span>
              <textarea value={reply} onChange={event => setReply(event.target.value)} placeholder="Write your reply here..." rows={6} />
            </label>
            <div className="reply-actions">
              <span>Replies are added to this ticket conversation.</span>
              <button type="button" className="primary" onClick={onReply} disabled={!reply.trim()}>Send Reply</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${slug(status)}`}>{status}</span>;
}
