export const API_URL = import.meta.env.VITE_API_URL ?? '';
let token = localStorage.getItem('ci360-token');
export const setToken = (value) => {
    token = value;
    if (value)
        localStorage.setItem('ci360-token', value);
    else
        localStorage.removeItem('ci360-token');
};
async function request(path, options = {}) {
    const response = await fetch(API_URL + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || 'Request failed');
    return data;
}
async function download(path, fileName) {
    const response = await fetch(API_URL + path, {
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
export const api = {
    login: (id, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ id, password }) }),
    bootstrap: () => request('/api/bootstrap'),
    createJob: (data) => request('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    updateJob: (id, data) => request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    saveSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    createClient: (data) => request('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    updateClient: (id, data) => request(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    createSupportTicket: (data) => request('/api/support-tickets', { method: 'POST', body: JSON.stringify(data) }),
    getSupportTicket: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}`),
    replySupportTicket: (ticketNumber, body) => request(`/api/support-tickets/${ticketNumber}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
    updateSupportTicket: (ticketNumber, data) => request(`/api/support-tickets/${ticketNumber}`, { method: 'PATCH', body: JSON.stringify(data) }),
    downloadTicketAttachment: (ticketNumber, attachmentId, fileName) => download(`/api/support-tickets/${ticketNumber}/attachments/${attachmentId}`, fileName)
};
