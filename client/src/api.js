export const API_URL = import.meta.env.VITE_API_URL ?? '';
let token = localStorage.getItem('ci360-token') || sessionStorage.getItem('ci360-token');
export const getToken = () => token;
export const setToken = (value, remember = true) => {
    token = value;
    localStorage.removeItem('ci360-token');
    sessionStorage.removeItem('ci360-token');
    if (!value)
        return;
    if (remember)
        localStorage.setItem('ci360-token', value);
    else
        sessionStorage.setItem('ci360-token', value);
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
    if (!response.ok) {
        const errorMsg = data.error || (response.status === 503 ? 'Database connecting / not ready' : 'Request failed');
        const hint = data.hint ? ` (${data.hint})` : '';
        throw new Error(errorMsg + hint);
    }
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
    jobs: (params = {}) => request(`/api/jobs?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()}`),
    job: (id) => request(`/api/jobs/${id}`),
    createJob: (data) => request('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    updateJob: (id, data) => request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delegateJob: (id, data) => request(`/api/jobs/${id}/delegate`, { method: 'POST', body: JSON.stringify(data) }),
    acceptDelegation: (id) => request(`/api/jobs/${id}/accept-delegation`, { method: 'POST' }),
    rejectDelegation: (id, reason) => request(`/api/jobs/${id}/reject-delegation`, { method: 'POST', body: JSON.stringify({ reason }) }),
    saveSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    createClient: (data) => request('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    updateClient: (id, data) => request(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteClient: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
    users: () => request('/api/users'),
    createUser: (data) => request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    updateUser: (id, data) => request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    userPermissionOverrides: (id) => request(`/api/users/${id}/permission-overrides`),
    updateUserPermissionOverrides: (id, data) => request(`/api/users/${id}/permission-overrides`, { method: 'PUT', body: JSON.stringify(data) }),
    departments: () => request('/api/departments'),
    createDepartment: (data) => request('/api/departments', { method: 'POST', body: JSON.stringify(data) }),
    updateDepartment: (id, data) => request(`/api/departments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    designations: () => request('/api/designations'),
    createDesignation: (data) => request('/api/designations', { method: 'POST', body: JSON.stringify(data) }),
    updateDesignation: (id, data) => request(`/api/designations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    roles: () => request('/api/rbac/roles'),
    createRole: (data) => request('/api/rbac/roles', { method: 'POST', body: JSON.stringify(data) }),
    updateRole: (id, data) => request(`/api/rbac/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    permissions: () => request('/api/rbac/permissions'),
    updateRolePermissions: (id, permissions) => request(`/api/rbac/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
    auditLogs: () => request('/api/audit-logs'),
    createSupportTicket: (data) => request('/api/support-tickets', { method: 'POST', body: JSON.stringify(data) }),
    getSupportTicket: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}`),
    replySupportTicket: (ticketNumber, payload) => request(`/api/support-tickets/${ticketNumber}/replies`, { method: 'POST', body: JSON.stringify(typeof payload === 'string' ? { body: payload } : payload) }),
    updateSupportTicket: (ticketNumber, data) => request(`/api/support-tickets/${ticketNumber}`, { method: 'PATCH', body: JSON.stringify(data) }),
    clearSupportTicketMessages: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}/messages`, { method: 'DELETE' }),
    deleteSupportTicket: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}`, { method: 'DELETE' }),
    deleteSupportTickets: (ticketNumbers) => request('/api/support-tickets/bulk-delete', { method: 'POST', body: JSON.stringify({ ticketNumbers }) }),
    downloadTicketAttachment: (ticketNumber, attachmentId, fileName) => download(`/api/support-tickets/${ticketNumber}/attachments/${attachmentId}`, fileName),
    chatChannels: () => request('/api/chat/channels'),
    createChatChannel: (data) => request('/api/chat/channels', { method: 'POST', body: JSON.stringify(data) }),
    chatMessages: (channelId, params = {}) => request(`/api/chat/channels/${channelId}/messages${params.limit ? `?limit=${params.limit}` : ''}`),
    sendChatMessage: (channelId, data) => request(`/api/chat/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(data) }),
    deleteChatMessage: (id) => request(`/api/chat/messages/${id}`, { method: 'DELETE' }),
    clearChatChannel: (channelId) => request(`/api/chat/channels/${channelId}/clear`, { method: 'POST' }),
    productivityDashboard: (params = {}) => request(`/api/productivity/dashboard?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityAnalysis: (params = {}) => request(`/api/productivity/analysis?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityAccounts: () => request('/api/productivity/accounts'),
    saveProductivityAccount: (data) => request('/api/productivity/accounts', { method: 'POST', body: JSON.stringify(data) }),
    reassignProductivityAccounts: (data) => request('/api/productivity/accounts/reassign', { method: 'POST', body: JSON.stringify(data) }),
    productivityTargets: () => request('/api/productivity/targets'),
    saveProductivityTarget: (data, id = null) => id ? request(`/api/productivity/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }) : request('/api/productivity/targets', { method: 'POST', body: JSON.stringify(data) }),
    deleteProductivityTarget: (id) => request(`/api/productivity/targets/${id}`, { method: 'DELETE' }),
    productivityReports: (params = {}) => request(`/api/productivity/reports?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityDailyLog: (params = {}) => request(`/api/productivity/daily-log?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityByClient: (params = {}) => request(`/api/productivity/by-client?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityByPerson: (params = {}) => request(`/api/productivity/by-person?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    productivityJobs: (params = {}) => request(`/api/productivity/jobs?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`),
    createProductivityJob: (data) => request('/api/productivity/jobs', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivityJob: (id, data) => request(`/api/productivity/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivityJob: (id) => request(`/api/productivity/jobs/${id}`, { method: 'DELETE' }),
    productivityServices: () => request('/api/productivity/services'),
    saveProductivityService: (data, id = null) => id ? request(`/api/productivity/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }) : request('/api/productivity/services', { method: 'POST', body: JSON.stringify(data) }),
    deleteProductivityService: (id) => request(`/api/productivity/services/${id}`, { method: 'DELETE' }),
    productivitySalaryGrades: () => request('/api/productivity/salary-grades'),
    saveProductivitySalaryGrade: (data, id = null) => id ? request(`/api/productivity/salary-grades/${id}`, { method: 'PUT', body: JSON.stringify(data) }) : request('/api/productivity/salary-grades', { method: 'POST', body: JSON.stringify(data) }),
    assignProductivitySalaryGrade: (employeeId, gradeId) => request(`/api/productivity/salary-assignments/${employeeId}`, { method: 'PUT', body: JSON.stringify({ gradeId }) }),
    productivitySettings: () => request('/api/productivity/settings'),
    updateProductivitySetting: (userId, data) => request(`/api/productivity/settings/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
    productivityExport: () => request('/api/productivity/export')
};
