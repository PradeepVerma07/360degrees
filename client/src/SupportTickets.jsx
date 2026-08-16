import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from './api';

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
const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'zip', 'webp']);
const maxAttachmentBytes = 10 * 1024 * 1024;

const fmt = value => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtRelative = value => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
};

const can = (data, permission) => (data.permissions || data.user?.permissions || []).includes(permission);

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
  if (!allowedExtensions.has(extension)) throw new Error('Attachment must be PDF, DOC, DOCX, JPG, JPEG, PNG, WEBP or ZIP.');
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    data: bytesToBase64(new Uint8Array(buffer))
  };
}

const getPriorityBadgeClass = priority => {
  switch ((priority || '').toLowerCase()) {
    case 'urgent': return 'badge-priority-urgent';
    case 'high': return 'badge-priority-urgent';
    case 'medium': return 'badge-priority-medium';
    default: return 'badge-priority-low';
  }
};

const getStatusBadgeClass = status => {
  switch ((status || '').toLowerCase()) {
    case 'open': return 'badge-status-submitted';
    case 'in progress': return 'badge-status-in-progress';
    case 'waiting for user': return 'badge-status-waiting-client';
    case 'resolved': return 'badge-status-completed';
    case 'closed': return 'badge-status-on-hold';
    default: return 'badge-status-submitted';
  }
};

const quickCannedReplies = [
  'We have received your request and our team is actively investigating this.',
  'Could you please provide additional details or screenshots to help us diagnose further?',
  'This issue has been resolved in the latest update. Please verify on your end.',
  'Thank you for bringing this to our attention. We are marking this ticket as resolved.'
];

export default function SupportTickets({ data, reload, openCreateSignal = 0 }) {
  const currentUser = data?.user || {};
  const isAdmin = can(data, 'support.manage') || can(data, 'support.view_all');
  const canCreateTicket = can(data, 'support.create');
  const canReplyTicket = can(data, 'support.reply');
  const canManageTickets = can(data, 'support.manage');

  const tickets = useMemo(() => data.supportTickets || [], [data.supportTickets]);

  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'Technical Issue', priority: 'Medium', description: '' });
  const [attachment, setAttachment] = useState(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [selectedTicketNumbers, setSelectedTicketNumbers] = useState([]);
  const [loadingTicket, setLoadingTicket] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [detailError, setDetailError] = useState('');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const replyFileInputRef = useRef(null);
  const socketRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => {
    selectedRef.current = selectedTicket;
  }, [selectedTicket]);

  const showNotification = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  };

  // Metrics KPI calculations
  const metrics = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter(t => t.status === 'Open').length;
    const inProgress = tickets.filter(t => t.status === 'In Progress').length;
    const waiting = tickets.filter(t => t.status === 'Waiting for User').length;
    const resolved = tickets.filter(t => ['Resolved', 'Closed'].includes(t.status)).length;
    const urgent = tickets.filter(t => ['High', 'Urgent'].includes(t.priority) && !['Resolved', 'Closed'].includes(t.status)).length;
    return { total, open, inProgress, waiting, resolved, urgent };
  }, [tickets]);

  // Filtered Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (activeFilter === 'open' && t.status !== 'Open') return false;
      if (activeFilter === 'in_progress' && t.status !== 'In Progress') return false;
      if (activeFilter === 'waiting' && t.status !== 'Waiting for User') return false;
      if (activeFilter === 'resolved' && !['Resolved', 'Closed'].includes(t.status)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mNum = (t.ticketNumber || '').toLowerCase().includes(q);
        const mSub = (t.subject || '').toLowerCase().includes(q);
        const mCat = (t.category || '').toLowerCase().includes(q);
        const mUser = (t.userName || '').toLowerCase().includes(q);
        if (!mNum && !mSub && !mCat && !mUser) return false;
      }
      return true;
    });
  }, [tickets, activeFilter, searchQuery]);

  // Open first ticket by default if none selected
  useEffect(() => {
    if (!selectedTicket && filteredTickets.length > 0) {
      loadTicketDetails(filteredTickets[0].ticketNumber);
    }
  }, [filteredTickets, selectedTicket]);

  // Handle openCreateSignal from header
  useEffect(() => {
    if (openCreateSignal) {
      setShowCreateModal(true);
    }
  }, [openCreateSignal]);

  // Real-time Socket.IO Connection for Instant Refresh
  useEffect(() => {
    const socket = io(API_URL || undefined);
    socketRef.current = socket;

    const handleRefresh = async () => {
      await reload();
      const current = selectedRef.current;
      if (current?.ticketNumber) {
        try {
          const res = await api.getSupportTicket(current.ticketNumber);
          setSelectedTicket(res.ticket);
        } catch {
          // ignore
        }
      }
    };

    socket.on('refresh', handleRefresh);
    socket.on('support:ticket_updated', handleRefresh);

    return () => {
      socket.disconnect();
    };
  }, [reload]);

  // Scroll to bottom of message thread
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  useEffect(() => {
    if (selectedTicket?.messages?.length) {
      scrollToBottom(false);
    }
  }, [selectedTicket?.messages?.length, scrollToBottom]);

  // Load Single Ticket Details
  const loadTicketDetails = async (ticketNumber) => {
    if (!ticketNumber) return;
    try {
      setLoadingTicket(true);
      setDetailError('');
      const res = await api.getSupportTicket(ticketNumber);
      setSelectedTicket(res.ticket);
    } catch (err) {
      setDetailError(err.message || 'Failed to load ticket details');
    } finally {
      setLoadingTicket(false);
    }
  };

  // Submit New Support Ticket
  const handleSubmitTicket = async e => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setFormError('');
      const file = await attachmentPayload(attachment);
      const res = await api.createSupportTicket({ ...form, attachment: file });
      setShowCreateModal(false);
      setForm({ subject: '', category: 'Technical Issue', priority: 'Medium', description: '' });
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showNotification(`Support Ticket ${res.ticket.ticketNumber} created successfully!`);
      await reload();
      setSelectedTicket(res.ticket);
    } catch (err) {
      setFormError(err.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  // Send Reply in Ticket Thread
  const handleSendReply = async e => {
    if (e) e.preventDefault();
    if (!replyText.trim() || !selectedTicket || sendingReply) return;

    try {
      setSendingReply(true);
      setDetailError('');
      const res = await api.replySupportTicket(selectedTicket.ticketNumber, replyText.trim());
      setSelectedTicket(res.ticket);
      setReplyText('');
      setReplyAttachment(null);
      if (replyFileInputRef.current) replyFileInputRef.current.value = '';
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  // Update Status / Priority
  const handleUpdateTicket = async patch => {
    if (!selectedTicket) return;
    try {
      setDetailError('');
      const res = await api.updateSupportTicket(selectedTicket.ticketNumber, patch);
      setSelectedTicket(res.ticket);
      showNotification(`Ticket updated to ${patch.status || patch.priority}.`);
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to update ticket');
    }
  };

  // Delete Single Ticket
  const handleDeleteTicket = async ticketNumber => {
    if (!window.confirm(`Are you sure you want to delete ticket #${ticketNumber}?`)) return;
    try {
      await api.deleteSupportTicket(ticketNumber);
      showNotification(`Ticket #${ticketNumber} deleted.`);
      setSelectedTicket(null);
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to delete ticket');
    }
  };

  // Clear Message Thread
  const handleClearMessages = async ticketNumber => {
    if (!window.confirm(`Clear all message history for ticket #${ticketNumber}?`)) return;
    try {
      const res = await api.clearSupportTicketMessages(ticketNumber);
      setSelectedTicket(res.ticket);
      showNotification('Ticket message thread cleared.');
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to clear messages');
    }
  };

  return (
    <div className="support-module-root">
      {/* 1. TOP EXECUTIVE METRIC CARDS */}
      <div className="metrics-row" style={{ marginBottom: '20px' }}>
        <div className="metric-card" style={{ flex: 1 }}>
          <div className="metric-card-content">
            <span className="metric-label">TOTAL TICKETS</span>
            <div className="metric-value">{metrics.total}</div>
            <div className="metric-footer">
              <span className="metric-subtext">All submitted tickets</span>
            </div>
          </div>
          <div className="metric-icon-badge" style={{ background: '#FFF4EA', color: 'var(--ci-navy)' }}>
            🎫
          </div>
        </div>

        <div className="metric-card" style={{ flex: 1 }}>
          <div className="metric-card-content">
            <span className="metric-label">OPEN QUEUE</span>
            <div className="metric-value" style={{ color: 'var(--ci-navy)' }}>{metrics.open}</div>
            <div className="metric-footer">
              <span className="metric-subtext">Awaiting initial triage</span>
            </div>
          </div>
          <div className="metric-icon-badge" style={{ background: '#E0F2FE', color: '#0284C7' }}>
            📥
          </div>
        </div>

        <div className="metric-card" style={{ flex: 1 }}>
          <div className="metric-card-content">
            <span className="metric-label">IN PROGRESS</span>
            <div className="metric-value" style={{ color: 'var(--ci-info)' }}>{metrics.inProgress}</div>
            <div className="metric-footer">
              <span className="metric-subtext">Being handled by staff</span>
            </div>
          </div>
          <div className="metric-icon-badge" style={{ background: 'var(--ci-info-bg)', color: 'var(--ci-info)' }}>
            ⚡
          </div>
        </div>

        <div className="metric-card" style={{ flex: 1 }}>
          <div className="metric-card-content">
            <span className="metric-label">URGENT PRIORITY</span>
            <div className="metric-value" style={{ color: 'var(--ci-danger)' }}>{metrics.urgent}</div>
            <div className="metric-footer">
              <span className="metric-subtext">Requires immediate action</span>
            </div>
          </div>
          <div className="metric-icon-badge" style={{ background: 'var(--ci-danger-bg)', color: 'var(--ci-danger)' }}>
            🔥
          </div>
        </div>

        <div className="metric-card" style={{ flex: 1 }}>
          <div className="metric-card-content">
            <span className="metric-label">RESOLVED</span>
            <div className="metric-value" style={{ color: 'var(--ci-success)' }}>{metrics.resolved}</div>
            <div className="metric-footer">
              <span className="metric-subtext">Successfully closed</span>
            </div>
          </div>
          <div className="metric-icon-badge" style={{ background: 'var(--ci-success-bg)', color: 'var(--ci-success)' }}>
            ✓
          </div>
        </div>
      </div>

      {toast && <div className="alert-banner success" style={{ marginBottom: '16px' }}>{toast}</div>}
      {detailError && <div className="alert-banner error" style={{ marginBottom: '16px' }}>{detailError}</div>}

      {/* 2. MAIN 2-COLUMN SPLIT DESK LAYOUT */}
      <div className="support-split-layout">
        {/* LEFT COLUMN: TICKET LIST & FILTERS */}
        <div className="support-list-panel saas-card">
          {/* Header & Create CTA */}
          <div className="support-list-header">
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ci-navy)' }}>Support Queue</h3>
              <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>{filteredTickets.length} tickets found</span>
            </div>
            {canCreateTicket && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowCreateModal(true)}
              >
                + Raise Ticket
              </button>
            )}
          </div>

          {/* Search Box */}
          <div style={{ padding: '0 16px 10px' }}>
            <div className="filter-search-box" style={{ width: '100%' }}>
              <input
                type="text"
                placeholder="Search ticket #, subject, client..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="support-filter-chips">
            <button
              type="button"
              className={`support-chip ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All ({metrics.total})
            </button>
            <button
              type="button"
              className={`support-chip ${activeFilter === 'open' ? 'active' : ''}`}
              onClick={() => setActiveFilter('open')}
            >
              Open ({metrics.open})
            </button>
            <button
              type="button"
              className={`support-chip ${activeFilter === 'in_progress' ? 'active' : ''}`}
              onClick={() => setActiveFilter('in_progress')}
            >
              In Progress ({metrics.inProgress})
            </button>
            <button
              type="button"
              className={`support-chip ${activeFilter === 'waiting' ? 'active' : ''}`}
              onClick={() => setActiveFilter('waiting')}
            >
              Waiting ({metrics.waiting})
            </button>
            <button
              type="button"
              className={`support-chip ${activeFilter === 'resolved' ? 'active' : ''}`}
              onClick={() => setActiveFilter('resolved')}
            >
              Resolved ({metrics.resolved})
            </button>
          </div>

          {/* Tickets Scroll List */}
          <div className="support-tickets-stream">
            {filteredTickets.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--ci-text-secondary)' }}>
                <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>📭</span>
                <strong>No tickets match your filters</strong>
                <p style={{ fontSize: '12px', margin: '4px 0 0 0' }}>Create a ticket or clear your search.</p>
              </div>
            ) : (
              filteredTickets.map(t => {
                const isSelected = selectedTicket?.ticketNumber === t.ticketNumber;
                return (
                  <div
                    key={t.ticketNumber}
                    className={`support-ticket-card-item ${isSelected ? 'active' : ''}`}
                    onClick={() => loadTicketDetails(t.ticketNumber)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <span className="support-ticket-num">#{t.ticketNumber}</span>
                      <span className="support-ticket-time">{fmtRelative(t.updatedAt || t.createdAt)}</span>
                    </div>

                    <h4 className="support-ticket-subject">{t.subject}</h4>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span className={`badge ${getPriorityBadgeClass(t.priority)}`} style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                          {t.priority}
                        </span>
                        <span className="badge badge-category" style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                          {t.category}
                        </span>
                      </div>
                      <span className={`badge ${getStatusBadgeClass(t.status)}`} style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                        {t.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '11.5px', color: 'var(--ci-text-secondary)' }}>
                      <span>👤 {t.userName || 'Client User'}</span>
                      {t.messagesCount > 0 && <span>💬 {t.messagesCount}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: LIVE CONVERSATION & TICKET WORKSPACE */}
        <div className="support-detail-panel saas-card">
          {loadingTicket ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px' }}>
              <div className="chat-spinner" />
              <span style={{ fontSize: '13px', color: 'var(--ci-text-secondary)', marginTop: '8px' }}>Loading ticket details...</span>
            </div>
          ) : selectedTicket ? (
            <div className="support-convo-wrapper">
              {/* Ticket Top Header & Actions */}
              <div className="support-convo-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className="support-header-badge">#{selectedTicket.ticketNumber}</span>
                    <span className={`badge ${getPriorityBadgeClass(selectedTicket.priority)}`}>
                      {selectedTicket.priority}
                    </span>
                    <span className="badge badge-category">{selectedTicket.category}</span>
                  </div>
                  <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '2px 0', color: 'var(--ci-navy)' }}>
                    {selectedTicket.subject}
                  </h2>
                  <span style={{ fontSize: '12px', color: 'var(--ci-text-secondary)' }}>
                    Raised by <strong>{selectedTicket.userName}</strong> on {fmt(selectedTicket.createdAt)}
                  </span>
                </div>

                {/* Header Action Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Status Dropdown */}
                  {canManageTickets ? (
                    <select
                      className="form-select"
                      style={{ height: '34px', fontSize: '12.5px', fontWeight: 600, padding: '0 10px', width: 'auto' }}
                      value={selectedTicket.status}
                      onChange={e => handleUpdateTicket({ status: e.target.value })}
                    >
                      {statuses.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge ${getStatusBadgeClass(selectedTicket.status)}`}>
                      {selectedTicket.status}
                    </span>
                  )}

                  {/* Clear / Delete Controls */}
                  {canManageTickets && (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="Clear conversation messages"
                        onClick={() => handleClearMessages(selectedTicket.ticketNumber)}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: 'var(--ci-danger)' }}
                        title="Delete ticket"
                        onClick={() => handleDeleteTicket(selectedTicket.ticketNumber)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Messages Thread Stream */}
              <div className="support-messages-stream">
                {selectedTicket.messages?.map((msg, idx) => {
                  const isStaff = ['admin', 'super_admin', 'employee'].includes(msg.authorRole);
                  const isOwn = msg.authorId === currentUser.id;

                  return (
                    <div key={msg.id || idx} className={`support-message-bubble-row ${isStaff ? 'staff' : 'user'} ${isOwn ? 'is-me' : ''}`}>
                      <div className="support-avatar-circle" style={{ background: isStaff ? 'var(--ci-navy)' : '#E0F2FE', color: isStaff ? '#FFFFFF' : '#0369A1' }}>
                        {(msg.authorName || 'U').charAt(0).toUpperCase()}
                      </div>

                      <div className="support-msg-card">
                        <div className="support-msg-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong className="support-msg-author">{msg.authorName}</strong>
                            <span className={`chat-role-pill ${isStaff ? 'role-admin' : 'role-client'}`} style={{ fontSize: '10px' }}>
                              {msg.authorRole === 'super_admin' ? 'Super Admin' : (msg.authorRole === 'admin' ? 'Support Lead' : (msg.authorRole === 'employee' ? 'Staff' : 'Client'))}
                            </span>
                          </div>
                          <span className="support-msg-time">{fmt(msg.createdAt)}</span>
                        </div>

                        <div className="support-msg-body">{msg.body}</div>

                        {/* Attachments if any */}
                        {msg.attachments?.map(att => (
                          <div key={att.id} className="support-attachment-item">
                            <span>📎 {att.fileName} ({(att.sizeBytes / 1024).toFixed(0)} KB)</span>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px', padding: '2px 8px' }}
                              onClick={() => api.downloadTicketAttachment(selectedTicket.ticketNumber, att.id, att.fileName)}
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Live Real-Time Reply Form */}
              {selectedTicket.status === 'Closed' ? (
                <div style={{ padding: '14px 20px', background: 'var(--ci-surface)', borderTop: '1px solid var(--ci-border)', textAlign: 'center', fontSize: '13px', color: 'var(--ci-text-secondary)' }}>
                  🔒 This support ticket has been closed. Change status to Open to continue discussion.
                </div>
              ) : canReplyTicket ? (
                <div className="support-reply-footer">
                  {/* Quick canned replies */}
                  <div className="support-canned-chips">
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ci-text-secondary)' }}>Quick:</span>
                    {quickCannedReplies.slice(0, 3).map((replyTextOption, i) => (
                      <button
                        key={i}
                        type="button"
                        className="support-canned-btn"
                        onClick={() => setReplyText(replyTextOption)}
                      >
                        {replyTextOption.slice(0, 32)}...
                      </button>
                    ))}
                  </div>

                  <form onSubmit={handleSendReply} style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                      <textarea
                        rows={2}
                        className="form-textarea"
                        style={{ flex: 1, resize: 'none', fontSize: '13.5px' }}
                        placeholder={`Reply to ticket #${selectedTicket.ticketNumber}... (Enter to send, Shift+Enter for newline)`}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendReply();
                          }
                        }}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ height: '48px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        disabled={sendingReply || !replyText.trim()}
                      >
                        {sendingReply ? 'Sending...' : 'Send Reply ➔'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--ci-text-secondary)' }}>
              <span style={{ fontSize: '36px', marginBottom: '8px' }}>🎫</span>
              <strong>No ticket selected</strong>
              <p style={{ fontSize: '13px', margin: '4px 0 0 0' }}>Select a ticket from the queue or create a new one.</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE NEW TICKET MODAL */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-dialog" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Raise New Support Ticket</h3>
              <button type="button" className="modal-close-btn" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmitTicket}>
              <div className="modal-body">
                {formError && <div className="alert-banner error" style={{ marginBottom: '12px' }}>{formError}</div>}

                <div className="form-group">
                  <label className="form-label">Subject / Issue Summary</label>
                  <input
                    type="text"
                    required
                    className="form-control"
                    placeholder="e.g. Turnaround calculation discrepancy on Job #128"
                    value={form.subject}
                    onChange={e => setForm({ ...form, subject: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select
                      className="form-select"
                      value={form.category}
                      onChange={e => setForm({ ...form, category: e.target.value })}
                    >
                      {categories.map(c => (
                        <option key={c} value={c}>{c}</option>
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
                      {priorities.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Detailed Description</label>
                  <textarea
                    rows={4}
                    required
                    className="form-textarea"
                    placeholder="Describe the issue, steps to reproduce, and any expected outcomes..."
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Attach File or Screenshot (Optional)</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="form-control"
                    onChange={e => setAttachment(e.target.files?.[0] || null)}
                  />
                  <small style={{ fontSize: '11px', color: 'var(--ci-text-secondary)', marginTop: '2px', display: 'block' }}>
                    Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP, ZIP (Max 10 MB)
                  </small>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Submitting Ticket...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
