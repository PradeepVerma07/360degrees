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
const quickReactions = ['👍', '❤️', '🙏', '✅', '🔥', '😊'];

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
  const [loadingTicket, setLoadingTicket] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Mobile split toggle: false = showing queue list, true = showing conversation
  const [mobileConvoActive, setMobileConvoActive] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const replyFileInputRef = useRef(null);
  const socketRef = useRef(null);

  const showNotification = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  // Open modal if parent sends signal
  useEffect(() => {
    if (openCreateSignal > 0) setShowCreateModal(true);
  }, [openCreateSignal]);

  // Load ticket details when selected
  const fetchTicketDetails = useCallback(async (ticketNumber, keepQuiet = false) => {
    if (!ticketNumber) return;
    try {
      if (!keepQuiet) setLoadingTicket(true);
      const res = await api.getSupportTicket(ticketNumber);
      setSelectedTicket(res.ticket);
      setDetailError('');
    } catch (err) {
      setDetailError(err.message || 'Failed to load ticket details');
    } finally {
      if (!keepQuiet) setLoadingTicket(false);
    }
  }, []);

  // Auto-select first ticket if none selected
  useEffect(() => {
    if (!selectedTicket && tickets.length > 0) {
      fetchTicketDetails(tickets[0].ticketNumber);
    }
  }, [tickets, selectedTicket, fetchTicketDetails]);

  // Auto-scroll messages to bottom
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

  // Real-Time Socket.IO Synchronization
  useEffect(() => {
    const socket = io(API_URL || undefined);
    socketRef.current = socket;

    socket.on('support:reply', ({ ticketNumber }) => {
      if (selectedTicket && selectedTicket.ticketNumber === ticketNumber) {
        fetchTicketDetails(ticketNumber, true);
      }
      reload();
    });

    socket.on('support:updated', ({ ticketNumber }) => {
      if (selectedTicket && selectedTicket.ticketNumber === ticketNumber) {
        fetchTicketDetails(ticketNumber, true);
      }
      reload();
    });

    socket.on('support:cleared', ({ ticketNumber }) => {
      if (selectedTicket && selectedTicket.ticketNumber === ticketNumber) {
        fetchTicketDetails(ticketNumber, true);
      }
      reload();
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedTicket, fetchTicketDetails, reload]);

  // Executive Metric Counts
  const metrics = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter(t => t.status === 'Open').length;
    const inProgress = tickets.filter(t => t.status === 'In Progress').length;
    const waiting = tickets.filter(t => t.status === 'Waiting for User').length;
    const urgent = tickets.filter(t => t.priority === 'Urgent' && !['Resolved', 'Closed'].includes(t.status)).length;
    const resolved = tickets.filter(t => ['Resolved', 'Closed'].includes(t.status)).length;
    return { total, open, inProgress, waiting, urgent, resolved };
  }, [tickets]);

  // Filtered Tickets for Left Queue
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      // Status tab filtering
      if (activeFilter === 'open' && t.status !== 'Open') return false;
      if (activeFilter === 'in_progress' && t.status !== 'In Progress') return false;
      if (activeFilter === 'waiting' && t.status !== 'Waiting for User') return false;
      if (activeFilter === 'resolved' && !['Resolved', 'Closed'].includes(t.status)) return false;
      if (activeFilter === 'closed' && t.status !== 'Closed') return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numMatch = (t.ticketNumber || '').toLowerCase().includes(q);
        const subjMatch = (t.subject || '').toLowerCase().includes(q);
        const userMatch = (t.userName || '').toLowerCase().includes(q);
        const catMatch = (t.category || '').toLowerCase().includes(q);
        return numMatch || subjMatch || userMatch || catMatch;
      }
      return true;
    });
  }, [tickets, activeFilter, searchQuery]);

  // Create Ticket Handler
  const handleSubmitTicket = async e => {
    e.preventDefault();
    if (!form.subject.trim()) {
      setFormError('Subject is required');
      return;
    }
    if (!form.description.trim() && !attachment) {
      setFormError('Please describe the issue or attach a file.');
      return;
    }
    try {
      setSubmitting(true);
      setFormError('');
      const res = await api.createSupportTicket({
        subject: form.subject.trim(),
        category: form.category,
        priority: form.priority,
        description: form.description.trim(),
        attachment: attachment || undefined
      });
      setShowCreateModal(false);
      setForm({ subject: '', category: 'Technical Issue', priority: 'Medium', description: '' });
      setAttachment(null);
      showNotification(`Ticket #${res.ticket.ticketNumber} created successfully!`);
      await reload();
      if (res.ticket) {
        setSelectedTicket(res.ticket);
        setMobileConvoActive(true);
      }
    } catch (err) {
      setFormError(err.message || 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  // Reply Handler (WhatsApp-Style)
  const handleSendReply = async e => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !replyAttachment) || sendingReply || !selectedTicket) return;
    try {
      setSendingReply(true);
      setDetailError('');
      const res = await api.replySupportTicket(selectedTicket.ticketNumber, {
        body: replyText.trim(),
        attachment: replyAttachment || undefined
      });
      setReplyText('');
      setReplyAttachment(null);
      setShowAttachMenu(false);
      setShowEmojiPicker(false);
      if (replyFileInputRef.current) replyFileInputRef.current.value = '';
      setSelectedTicket(res.ticket);
      scrollToBottom(true);
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  // Reply File Select
  const handleReplyFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = await attachmentPayload(file);
      setReplyAttachment(payload);
      setShowAttachMenu(false);
    } catch (err) {
      setDetailError(err.message);
    }
  };

  // Update Status / Priority Handler
  const handleUpdateTicket = async patch => {
    if (!selectedTicket) return;
    try {
      const res = await api.updateSupportTicket(selectedTicket.ticketNumber, patch);
      setSelectedTicket(res.ticket);
      showNotification(`Ticket #${selectedTicket.ticketNumber} updated to ${patch.status || patch.priority}`);
      await reload();
    } catch (err) {
      setDetailError(err.message || 'Failed to update ticket');
    }
  };

  // Delete Ticket
  const handleDeleteTicket = async ticketNumber => {
    if (!window.confirm(`Are you sure you want to permanently delete ticket #${ticketNumber}?`)) return;
    try {
      await api.deleteSupportTicket(ticketNumber);
      showNotification(`Ticket #${ticketNumber} deleted.`);
      setSelectedTicket(null);
      setMobileConvoActive(false);
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
      {/* 1. TOP EXECUTIVE METRIC CARDS (IN A SINGLE ROW) */}
      <div className="support-metrics-row">
        {/* Metric 1: Total Tickets */}
        <div className="support-metric-card">
          <div className="support-metric-content">
            <span className="support-metric-label">TOTAL TICKETS</span>
            <div className="support-metric-value">{metrics.total}</div>
            <span className="support-metric-subtext">All submitted tickets</span>
          </div>
          <div className="support-metric-icon" style={{ background: '#FFF4EA', color: 'var(--ci-navy)' }}>
            🎫
          </div>
        </div>

        {/* Metric 2: Open Queue */}
        <div className="support-metric-card">
          <div className="support-metric-content">
            <span className="support-metric-label">OPEN QUEUE</span>
            <div className="support-metric-value" style={{ color: 'var(--ci-navy)' }}>{metrics.open}</div>
            <span className="support-metric-subtext">Awaiting initial triage</span>
          </div>
          <div className="support-metric-icon" style={{ background: '#E0F2FE', color: '#0284C7' }}>
            📥
          </div>
        </div>

        {/* Metric 3: In Progress */}
        <div className="support-metric-card">
          <div className="support-metric-content">
            <span className="support-metric-label">IN PROGRESS</span>
            <div className="support-metric-value" style={{ color: 'var(--ci-info)' }}>{metrics.inProgress}</div>
            <span className="support-metric-subtext">Being handled by staff</span>
          </div>
          <div className="support-metric-icon" style={{ background: 'var(--ci-info-bg)', color: 'var(--ci-info)' }}>
            ⚡
          </div>
        </div>

        {/* Metric 4: Urgent Priority */}
        <div className="support-metric-card">
          <div className="support-metric-content">
            <span className="support-metric-label">URGENT PRIORITY</span>
            <div className="support-metric-value" style={{ color: 'var(--ci-danger)' }}>{metrics.urgent}</div>
            <span className="support-metric-subtext">Requires immediate action</span>
          </div>
          <div className="support-metric-icon" style={{ background: 'var(--ci-danger-bg)', color: 'var(--ci-danger)' }}>
            🔥
          </div>
        </div>

        {/* Metric 5: Resolved */}
        <div className="support-metric-card">
          <div className="support-metric-content">
            <span className="support-metric-label">RESOLVED</span>
            <div className="support-metric-value" style={{ color: 'var(--ci-success)' }}>{metrics.resolved}</div>
            <span className="support-metric-subtext">Successfully closed</span>
          </div>
          <div className="support-metric-icon" style={{ background: 'var(--ci-success-bg)', color: 'var(--ci-success)' }}>
            ✓
          </div>
        </div>
      </div>

      {toast && <div className="alert-banner success" style={{ marginBottom: '12px', padding: '8px 14px' }}>{toast}</div>}
      {detailError && <div className="alert-banner error" style={{ marginBottom: '12px', padding: '8px 14px' }}>{detailError}</div>}

      {/* 2. MAIN 2-COLUMN SPLIT DESK (RESPONSIVE VIEWPORT FIT) */}
      <div className={`support-split-layout ${mobileConvoActive ? 'mobile-convo-active' : 'mobile-queue-active'}`}>
        {/* LEFT COLUMN: TICKET QUEUE */}
        <div className="support-list-panel saas-card">
          {/* Header & Create CTA */}
          <div className="support-list-header">
            <div>
              <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, color: 'var(--ci-navy)' }}>Support Queue</h3>
              <span style={{ fontSize: '11.5px', color: 'var(--ci-text-secondary)' }}>{filteredTickets.length} tickets found</span>
            </div>
            {canCreateTicket && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setShowCreateModal(true)}
              >
                + Raise Ticket
              </button>
            )}
          </div>

          {/* Search Box */}
          <div style={{ padding: '0 12px 8px' }}>
            <div className="filter-search-box" style={{ width: '100%' }}>
              <input
                type="text"
                style={{ height: '32px', fontSize: '12px' }}
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

          {/* Ticket Cards Stream */}
          <div className="support-tickets-stream">
            {filteredTickets.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ci-text-secondary)', fontSize: '12.5px' }}>
                <span>🎫</span>
                <p style={{ margin: '6px 0 0 0' }}>No tickets in this queue</p>
              </div>
            ) : (
              filteredTickets.map(t => {
                const isSelected = selectedTicket?.ticketNumber === t.ticketNumber;
                return (
                  <div
                    key={t.ticketNumber}
                    className={`support-ticket-card-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      fetchTicketDetails(t.ticketNumber);
                      setMobileConvoActive(true);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <span className="support-ticket-num">#{t.ticketNumber}</span>
                      <span className="support-ticket-time">{fmtRelative(t.updatedAt || t.createdAt)}</span>
                    </div>

                    <h4 className="support-ticket-subject">{t.subject}</h4>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '5px 0' }}>
                      <span className={`badge ${getPriorityBadgeClass(t.priority)}`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                        {t.priority}
                      </span>
                      <span className="badge badge-category" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        {t.category}
                      </span>
                      <span className={`badge ${getStatusBadgeClass(t.status)}`} style={{ fontSize: '10px', padding: '1px 6px', marginLeft: 'auto' }}>
                        {t.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--ci-text-secondary)', marginTop: '4px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px' }}>
              <div className="chat-spinner" />
              <span style={{ fontSize: '12.5px', color: 'var(--ci-text-secondary)', marginTop: '8px' }}>Loading ticket details...</span>
            </div>
          ) : selectedTicket ? (
            <div className="support-convo-wrapper">
              {/* Ticket Top Header & Actions */}
              <div className="support-convo-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  {/* Mobile Back Arrow to Queue */}
                  <button
                    type="button"
                    className="support-back-arrow-btn"
                    title="Back to queue"
                    onClick={() => setMobileConvoActive(false)}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  </button>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
                      <span className="support-header-badge">#{selectedTicket.ticketNumber}</span>
                      <span className={`badge ${getPriorityBadgeClass(selectedTicket.priority)}`} style={{ fontSize: '10.5px' }}>
                        {selectedTicket.priority}
                      </span>
                      <span className="badge badge-category" style={{ fontSize: '10.5px' }}>{selectedTicket.category}</span>
                    </div>
                    <h2 style={{ fontSize: '14.5px', fontWeight: 700, margin: '2px 0', color: 'var(--ci-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedTicket.subject}
                    </h2>
                    <span style={{ fontSize: '11px', color: 'var(--ci-text-secondary)' }}>
                      Raised by <strong>{selectedTicket.userName}</strong> on {fmt(selectedTicket.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Header Action Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {/* Status Dropdown */}
                  {canManageTickets ? (
                    <select
                      className="form-select"
                      style={{ height: '30px', fontSize: '11.5px', fontWeight: 600, padding: '0 8px', width: 'auto' }}
                      value={selectedTicket.status}
                      onChange={e => handleUpdateTicket({ status: e.target.value })}
                    >
                      {statuses.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge ${getStatusBadgeClass(selectedTicket.status)}`} style={{ fontSize: '11.5px' }}>
                      {selectedTicket.status}
                    </span>
                  )}

                  {/* Clear / Delete Controls */}
                  {canManageTickets && (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ height: '30px', padding: '0 8px', fontSize: '11.5px' }}
                        title="Clear conversation messages"
                        onClick={() => handleClearMessages(selectedTicket.ticketNumber)}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ height: '30px', padding: '0 8px', fontSize: '11.5px', color: 'var(--ci-danger)' }}
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
                      <div className="support-avatar-circle" style={{ background: isStaff ? 'var(--ci-navy)' : '#0284C7', color: '#FFFFFF' }}>
                        {(msg.authorName || 'U').charAt(0).toUpperCase()}
                      </div>

                      <div className="support-msg-card">
                        <div className="support-msg-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong className="support-msg-author">{msg.authorName}</strong>
                            <span className={`chat-role-pill ${isStaff ? 'role-admin' : 'role-client'}`} style={{ fontSize: '9.5px', padding: '1px 5px' }}>
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
                              style={{ fontSize: '10.5px', padding: '1px 6px' }}
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

              {/* WHATSAPP-STYLE LIVE REAL-TIME REPLY FOOTER */}
              {selectedTicket.status === 'Closed' ? (
                <div style={{ padding: '10px 16px', background: 'var(--ci-surface)', borderTop: '1px solid var(--ci-border-light)', textAlign: 'center', fontSize: '12px', color: 'var(--ci-text-secondary)' }}>
                  🔒 This support ticket is closed. Change status to Open to continue replying.
                </div>
              ) : canReplyTicket ? (
                <div className="support-reply-footer">
                  {/* Attachment Preview if selected */}
                  {replyAttachment && (
                    <div className="wa-attach-preview-banner" style={{ margin: '0 0 6px 0', padding: '4px 10px', fontSize: '11.5px' }}>
                      <span>📎 {replyAttachment.name} ({(replyAttachment.size / 1024).toFixed(1)} KB)</span>
                      <button type="button" onClick={() => setReplyAttachment(null)}>✕</button>
                    </div>
                  )}

                  {/* Quick canned replies */}
                  <div className="support-canned-chips">
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ci-text-secondary)' }}>Quick:</span>
                    {quickCannedReplies.map((replyTextOption, i) => (
                      <button
                        key={i}
                        type="button"
                        className="support-canned-btn"
                        onClick={() => setReplyText(replyTextOption)}
                      >
                        {replyTextOption.slice(0, 26)}...
                      </button>
                    ))}
                  </div>

                  {/* Quick emoji reactions */}
                  {showEmojiPicker && (
                    <div className="wa-emoji-quick-bar" style={{ margin: '6px 0' }}>
                      {quickReactions.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setReplyText(prev => prev + emoji);
                            setShowEmojiPicker(false);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* WhatsApp-Style Input Bar */}
                  <div className="support-wa-reply-bar">
                    {/* Plus / Attach Button */}
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="support-wa-icon-btn"
                        title="Attach file"
                        onClick={() => setShowAttachMenu(v => !v)}
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>

                      {showAttachMenu && (
                        <div className="wa-attach-popup" style={{ bottom: '44px', left: 0 }}>
                          <label className="wa-attach-option">
                            <span className="wa-attach-opt-icon" style={{ background: '#7f66ff' }}>📄</span>
                            <span>Document / File</span>
                            <input
                              ref={replyFileInputRef}
                              type="file"
                              style={{ display: 'none' }}
                              onChange={handleReplyFile}
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Emoji Button */}
                    <button
                      type="button"
                      className="support-wa-icon-btn"
                      title="Emoji"
                      onClick={() => setShowEmojiPicker(v => !v)}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </button>

                    {/* Rounded Text Input Field */}
                    <input
                      type="text"
                      className="support-wa-input"
                      placeholder={`Reply to ticket #${selectedTicket.ticketNumber}...`}
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      disabled={sendingReply}
                    />

                    {/* WhatsApp-Style Circular Send Button */}
                    <button
                      type="button"
                      className="support-wa-send-btn"
                      onClick={handleSendReply}
                      disabled={sendingReply || (!replyText.trim() && !replyAttachment)}
                      title="Send reply"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px', color: 'var(--ci-text-secondary)' }}>
              <span style={{ fontSize: '32px', marginBottom: '6px' }}>🎫</span>
              <strong style={{ fontSize: '14px' }}>No ticket selected</strong>
              <p style={{ fontSize: '12px', margin: '4px 0 0 0' }}>Select a ticket from the queue or raise a new one.</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE NEW TICKET MODAL */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-dialog" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
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
                  <label className="form-label">Description / Message</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Provide details about the issue or request..."
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Attachment (Optional)</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="form-control"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const payload = await attachmentPayload(file);
                        setAttachment(payload);
                      } catch (err) {
                        setFormError(err.message);
                      }
                    }}
                  />
                  {attachment && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--ci-text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>📎 {attachment.name} ({(attachment.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        style={{ border: 'none', background: 'transparent', color: 'var(--ci-danger)', cursor: 'pointer' }}
                        onClick={() => {
                          setAttachment(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
