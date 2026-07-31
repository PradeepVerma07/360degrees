import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
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
const fmt = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}
async function attachmentPayload(file) {
    if (!file)
        return null;
    if (file.size > maxAttachmentBytes)
        throw new Error('Attachment must be 10 MB or smaller.');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowedExtensions.has(extension))
        throw new Error('Attachment must be PDF, DOC, DOCX, JPG, JPEG, PNG or ZIP.');
    const buffer = await file.arrayBuffer();
    return {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: bytesToBase64(new Uint8Array(buffer))
    };
}
export default function SupportTickets({ data, reload, openCreateSignal = 0 }) {
    const isAdmin = data.user.role === 'admin';
    const tickets = useMemo(() => data.supportTickets || [], [data.supportTickets]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ subject: '', category: 'Technical Issue', priority: 'Medium', description: '' });
    const [attachment, setAttachment] = useState(null);
    const [formError, setFormError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState('');
    const [selected, setSelected] = useState(null);
    const [loadingTicket, setLoadingTicket] = useState('');
    const [reply, setReply] = useState('');
    const [detailError, setDetailError] = useState('');
    useEffect(() => {
        if (!toast)
            return;
        const timer = window.setTimeout(() => setToast(''), 4500);
        return () => window.clearTimeout(timer);
    }, [toast]);
    useEffect(() => {
        if (!openCreateSignal)
            return;
        setSelected(null);
        setShowForm(true);
    }, [openCreateSignal]);
    const resetForm = () => {
        setForm({ subject: '', category: 'Technical Issue', priority: 'Medium', description: '' });
        setAttachment(null);
        setFormError('');
    };
    const submitTicket = async (event) => {
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
        }
        catch (error) {
            setFormError(error.message);
        }
        finally {
            setSubmitting(false);
        }
    };
    const openTicket = async (ticketNumber) => {
        setLoadingTicket(ticketNumber);
        setDetailError('');
        setShowForm(false);
        try {
            const result = await api.getSupportTicket(ticketNumber);
            setSelected(result.ticket);
            setReply('');
        }
        catch (error) {
            setDetailError(error.message);
        }
        finally {
            setLoadingTicket('');
        }
    };
    const updateTicket = async (patch) => {
        if (!selected)
            return;
        setDetailError('');
        try {
            const result = await api.updateSupportTicket(selected.ticketNumber, patch);
            setSelected(result.ticket);
            setToast('Ticket updated.');
            await reload();
        }
        catch (error) {
            setDetailError(error.message);
        }
    };
    const sendReply = async () => {
        if (!selected || !reply.trim())
            return;
        setDetailError('');
        try {
            const result = await api.replySupportTicket(selected.ticketNumber, reply.trim());
            setSelected(result.ticket);
            setReply('');
            setToast('Reply sent.');
            await reload();
        }
        catch (error) {
            setDetailError(error.message);
        }
    };
    const downloadAttachment = async (ticketNumber, id, fileName) => {
        try {
            await api.downloadTicketAttachment(ticketNumber, id, fileName);
        }
        catch (error) {
            setDetailError(error.message);
        }
    };
    return (_jsxs("section", { className: `support-page ${selected ? 'ticket-open' : ''}`, children: [toast && _jsx("div", { className: "toast", role: "status", children: toast }), _jsxs("div", { className: "page-title", children: [_jsxs("div", { children: [_jsx("h2", { children: isAdmin ? 'Support Tickets' : 'My Support Tickets' }), _jsx("p", { className: "muted", children: isAdmin ? 'Review, reply to, and manage every submitted ticket.' : 'Raise a ticket and track every support conversation in one place.' })] }), _jsx("button", { type: "button", className: "primary", onClick: () => setShowForm(true), children: "+ Raise Ticket" })] }), detailError && !selected && _jsx("div", { className: "alert error", children: detailError }), selected ? _jsx(TicketDetailModal, { ticket: selected, isAdmin: isAdmin, reply: reply, detailError: detailError, setReply: setReply, onClose: () => setSelected(null), onReply: sendReply, onUpdate: updateTicket, onDownload: downloadAttachment }) : tickets.length === 0 ? (_jsxs("div", { className: "card empty-state", children: [_jsx("h3", { children: "No support tickets found." }), _jsx("button", { type: "button", className: "primary", onClick: () => setShowForm(true), children: "Raise Your First Ticket" })] })) : (_jsx(TicketTable, { tickets: tickets, isAdmin: isAdmin, loadingTicket: loadingTicket, onView: openTicket })), showForm && (_jsx("div", { className: "modal-backdrop", role: "dialog", "aria-modal": "true", "aria-labelledby": "raise-ticket-title", children: _jsxs("form", { className: "modal-panel ticket-form", onSubmit: submitTicket, children: [_jsxs("div", { className: "modal-head", children: [_jsxs("div", { children: [_jsx("h2", { id: "raise-ticket-title", children: "Raise Support Ticket" }), _jsx("p", { className: "muted", children: "Share the issue details and the support team will follow up here." })] }), _jsx("button", { type: "button", className: "icon-button", "aria-label": "Close ticket form", onClick: () => { resetForm(); setShowForm(false); }, children: "x" })] }), formError && _jsx("div", { className: "alert error", children: formError }), _jsxs("label", { children: ["Subject", _jsx("input", { required: true, value: form.subject, onChange: event => setForm({ ...form, subject: event.target.value }) })] }), _jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Category", _jsx("select", { value: form.category, onChange: event => setForm({ ...form, category: event.target.value }), children: categories.map(category => _jsx("option", { children: category }, category)) })] }), _jsxs("label", { children: ["Priority", _jsx("select", { value: form.priority, onChange: event => setForm({ ...form, priority: event.target.value }), children: priorities.map(priority => _jsx("option", { children: priority }, priority)) })] })] }), _jsxs("label", { children: ["Description", _jsx("textarea", { required: true, value: form.description, onChange: event => setForm({ ...form, description: event.target.value }) })] }), _jsxs("label", { children: ["Attachment", _jsx("input", { type: "file", accept: ".pdf,.doc,.docx,.jpg,.jpeg,.png,.zip", onChange: event => setAttachment(event.target.files?.[0] || null) })] }), _jsx("p", { className: "field-note", children: "Allowed: PDF, DOC, DOCX, JPG, JPEG, PNG, ZIP. Maximum size: 10 MB." }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", onClick: () => { resetForm(); setShowForm(false); }, children: "Cancel" }), _jsx("button", { type: "submit", className: "primary", disabled: submitting, children: submitting ? 'Submitting...' : 'Submit Ticket' })] })] }) }))] }));
}
function TicketTable({ tickets, isAdmin, loadingTicket, onView }) {
    return (_jsx("div", { className: "card table-card", children: _jsx("div", { className: "responsive-table", children: _jsxs("table", { className: "ticket-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Ticket ID" }), isAdmin && _jsx("th", { children: "User" }), _jsx("th", { children: "Subject" }), _jsx("th", { children: "Category" }), _jsx("th", { children: "Priority" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Created Date" }), _jsx("th", { children: "Action" })] }) }), _jsx("tbody", { children: tickets.map(ticket => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("b", { children: ticket.ticketNumber }) }), isAdmin && _jsx("td", { children: ticket.userName }), _jsx("td", { children: ticket.subject }), _jsx("td", { children: ticket.category }), _jsx("td", { children: _jsx("span", { className: `priority-badge priority-${slug(ticket.priority)}`, children: ticket.priority }) }), _jsx("td", { children: _jsx(StatusBadge, { status: ticket.status }) }), _jsx("td", { children: fmt(ticket.createdAt) }), _jsx("td", { children: _jsx("button", { type: "button", className: "small", onClick: () => onView(ticket.ticketNumber), children: loadingTicket === ticket.ticketNumber ? 'Opening...' : 'View' }) })] }, ticket.ticketNumber))) })] }) }) }));
}
function TicketDetailModal({ ticket, isAdmin, reply, detailError, setReply, onClose, onReply, onUpdate, onDownload }) {
    const closed = ticket.status === 'Closed';
    return (_jsxs("section", { className: "card ticket-detail ticket-detail-page", role: "region", "aria-labelledby": "ticket-detail-title", children: [_jsxs("div", { className: "modal-head ticket-detail-head", children: [_jsxs("div", { children: [_jsx("button", { type: "button", className: "small ticket-back", onClick: onClose, children: "< Back to Tickets" }), _jsx("h2", { id: "ticket-detail-title", children: ticket.ticketNumber }), _jsx("p", { className: "muted", children: ticket.subject })] }), _jsx("button", { type: "button", className: "icon-button", "aria-label": "Close ticket detail", onClick: onClose, children: "x" })] }), detailError && _jsx("div", { className: "alert error", children: detailError }), _jsxs("div", { className: "ticket-meta", children: [_jsxs("div", { children: [_jsx("span", { children: "Category" }), _jsx("b", { children: ticket.category })] }), _jsxs("div", { children: [_jsx("span", { children: "Priority" }), _jsx("b", { children: ticket.priority })] }), _jsxs("div", { children: [_jsx("span", { children: "Status" }), _jsx(StatusBadge, { status: ticket.status })] }), _jsxs("div", { children: [_jsx("span", { children: "Created date" }), _jsx("b", { children: fmt(ticket.createdAt) })] }), isAdmin && _jsxs("div", { children: [_jsx("span", { children: "User" }), _jsx("b", { children: ticket.userName })] })] }), isAdmin && (_jsxs("div", { className: "admin-ticket-controls", children: [_jsxs("label", { children: ["Status", _jsx("select", { value: ticket.status, onChange: event => onUpdate({ status: event.target.value }), children: statuses.map(status => _jsx("option", { children: status }, status)) })] }), _jsxs("label", { children: ["Priority", _jsx("select", { value: ticket.priority, onChange: event => onUpdate({ priority: event.target.value }), children: priorities.map(priority => _jsx("option", { children: priority }, priority)) })] }), _jsx("button", { type: "button", className: "danger", onClick: () => onUpdate({ status: 'Closed' }), disabled: closed, children: "Close Ticket" })] })), _jsx("h3", { children: "Complete conversation" }), _jsx("div", { className: "conversation", children: ticket.messages.map(message => (_jsxs("article", { className: `message ${message.authorRole}`, children: [_jsxs("div", { className: "message-head", children: [_jsx("b", { children: message.authorName }), _jsxs("span", { children: [message.authorRole === 'admin' ? 'Admin reply' : 'User reply', " - ", fmt(message.createdAt)] })] }), _jsx("p", { children: message.body }), message.attachments.length > 0 && (_jsx("div", { className: "attachment-list", children: message.attachments.map(attachment => (_jsx("button", { type: "button", className: "attachment-chip", onClick: () => onDownload(ticket.ticketNumber, attachment.id, attachment.fileName), children: attachment.fileName }, attachment.id))) }))] }, message.id))) }), ticket.attachments.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Attachments" }), _jsx("div", { className: "attachment-list", children: ticket.attachments.map(attachment => (_jsx("button", { type: "button", className: "attachment-chip", onClick: () => onDownload(ticket.ticketNumber, attachment.id, attachment.fileName), children: attachment.fileName }, attachment.id))) })] })), _jsx("div", { className: "reply-box", children: closed ? (_jsx("div", { className: "alert", children: "This ticket has been closed." })) : (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Reply box", _jsx("textarea", { value: reply, onChange: event => setReply(event.target.value), placeholder: "Write your reply..." })] }), _jsx("button", { type: "button", className: "primary", onClick: onReply, disabled: !reply.trim(), children: "Send Reply" })] })) })] }));
}
function StatusBadge({ status }) {
    return _jsx("span", { className: `status-badge status-${slug(status)}`, children: status });
}
