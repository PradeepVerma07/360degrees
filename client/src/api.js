const APP_USER_AGENT_TOKEN = 'CI360AndroidApp';

const hasNativeAppFlag = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('ci360_app') === 'android') {
            localStorage.setItem('ci360-platform', 'android');
            return true;
        }
        return localStorage.getItem('ci360-platform') === 'android';
    }
    catch {
        return false;
    }
};

export const IS_NATIVE_APP = typeof window !== 'undefined' && (
    hasNativeAppFlag()
    || window.__CI360_ANDROID_APP__ === true
    || window.Capacitor?.isNativePlatform?.()
    || ['android', 'ios'].includes(window.Capacitor?.getPlatform?.())
    || ['capacitor:', 'file:'].includes(window.location.protocol)
    || (['http:', 'https:'].includes(window.location.protocol) && window.location.hostname === 'localhost' && !window.location.port)
    || window.navigator?.userAgent?.includes(APP_USER_AGENT_TOKEN)
);

if (IS_NATIVE_APP) {
    document.documentElement.classList.add('ci360-android-app');
}
export const API_URL = import.meta.env.VITE_API_URL ?? (IS_NATIVE_APP ? 'https://360.webtrionix.com' : '');
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
        const error = new Error(data.error || 'Request failed');
        error.status = response.status;
        error.details = data;
        throw error;
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
const queryString = (params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '')
            search.set(key, String(value));
    });
    const text = search.toString();
    return text ? `?${text}` : '';
};
export const api = {
    login: (id, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ id, password }) }),
    bootstrap: () => request('/api/bootstrap'),
    jobs: (params = {}) => request(`/api/jobs${queryString(params)}`),
    job: (id) => request(`/api/jobs/${id}`),
    jobOptions: (params = {}) => request(`/api/job-options${queryString(params)}`),
    createJob: (data) => request('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    updateJob: (id, data) => request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    assignmentRequests: () => request('/api/jobs/assignment-requests'),
    acceptJobAssignment: (id) => request(`/api/jobs/${id}/accept`, { method: 'POST', body: JSON.stringify({}) }),
    declineJobAssignment: (id, reason = '') => request(`/api/jobs/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason }) }),
    dispatchQueue: () => request('/api/jobs/dispatch-queue'),
    createDispatchOffer: (id, data) => request(`/api/jobs/${id}/dispatch-offer`, { method: 'POST', body: JSON.stringify(data) }),
    assignJobToMe: (id) => request(`/api/jobs/${id}/assign-to-me`, { method: 'POST', body: JSON.stringify({}) }),
    notifications: () => request('/api/notifications'),
    markNotificationRead: (id) => request(`/api/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) }),
    markAllNotificationsRead: () => request('/api/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }),
    jobCoordinators: () => request('/api/job-coordinators'),
    createJobCoordinator: (data) => request('/api/job-coordinators', { method: 'POST', body: JSON.stringify(data) }),
    updateJobCoordinator: (id, data) => request(`/api/job-coordinators/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
    modules: () => request('/api/modules'),
    moduleAccess: () => request('/api/module-access'),
    moduleAccessFor: (moduleKey) => request(`/api/module-access/${moduleKey}`),
    createModuleAccess: (data) => request('/api/module-access', { method: 'POST', body: JSON.stringify(data) }),
    updateModuleAccess: (id, data) => request(`/api/module-access/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteModuleAccess: (id) => request(`/api/module-access/${id}`, { method: 'DELETE' }),
    evaluateModuleAccess: (moduleKey, userId) => request(`/api/module-access/${moduleKey}/evaluate`, { method: 'POST', body: JSON.stringify({ userId }) }),
    productivityMeta: () => request('/api/productivity/meta'),
    productivityDashboard: (params = {}) => request(`/api/productivity/dashboard${queryString(params)}`),
    productivityAnalysis: () => request('/api/productivity/analysis'),
    productivityAccounts: (params = {}) => request(`/api/productivity/accounts${queryString(params)}`),
    createProductivityAccount: (data) => request('/api/productivity/accounts', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivityAccount: (id, data) => request(`/api/productivity/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivityAccount: (id) => request(`/api/productivity/accounts/${id}`, { method: 'DELETE' }),
    reassignProductivityAccounts: (data) => request('/api/productivity/accounts/reassign', { method: 'POST', body: JSON.stringify(data) }),
    productivityTargets: () => request('/api/productivity/targets'),
    createProductivityTarget: (data) => request('/api/productivity/targets', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivityTarget: (id, data) => request(`/api/productivity/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivityTarget: (id) => request(`/api/productivity/targets/${id}`, { method: 'DELETE' }),
    productivityReports: (params = {}) => request(`/api/productivity/reports${queryString(params)}`),
    productivityJobs: (params = {}) => request(`/api/productivity/jobs${queryString(params)}`),
    createProductivityJob: (data) => request('/api/productivity/jobs', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivityJob: (id, data) => request(`/api/productivity/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivityJob: (id) => request(`/api/productivity/jobs/${id}`, { method: 'DELETE' }),
    productivityDailyLog: (params = {}) => request(`/api/productivity/daily-log${queryString(params)}`),
    productivityByClient: (params = {}) => request(`/api/productivity/by-client${queryString(params)}`),
    productivityByPerson: (params = {}) => request(`/api/productivity/by-person${queryString(params)}`),
    productivityServices: () => request('/api/productivity/services'),
    createProductivityService: (data) => request('/api/productivity/services', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivityService: (id, data) => request(`/api/productivity/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivityService: (id) => request(`/api/productivity/services/${id}`, { method: 'DELETE' }),
    updateProductivityEmployeeSettings: (userId, data) => request(`/api/productivity/employee-settings/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
    productivitySalaryGrades: () => request('/api/productivity/salary-grades'),
    createProductivitySalaryGrade: (data) => request('/api/productivity/salary-grades', { method: 'POST', body: JSON.stringify(data) }),
    updateProductivitySalaryGrade: (id, data) => request(`/api/productivity/salary-grades/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProductivitySalaryGrade: (id) => request(`/api/productivity/salary-grades/${id}`, { method: 'DELETE' }),
    updateProductivitySalaryAssignment: (employeeId, gradeId) => request(`/api/productivity/salary-assignments/${employeeId}`, { method: 'PUT', body: JSON.stringify({ gradeId }) }),
    auditLogs: () => request('/api/audit-logs'),
    createSupportTicket: (data) => request('/api/support-tickets', { method: 'POST', body: JSON.stringify(data) }),
    getSupportTicket: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}`),
    replySupportTicket: (ticketNumber, body) => request(`/api/support-tickets/${ticketNumber}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
    updateSupportTicket: (ticketNumber, data) => request(`/api/support-tickets/${ticketNumber}`, { method: 'PATCH', body: JSON.stringify(data) }),
    clearSupportTicketMessages: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}/messages`, { method: 'DELETE' }),
    deleteSupportTicket: (ticketNumber) => request(`/api/support-tickets/${ticketNumber}`, { method: 'DELETE' }),
    deleteSupportTickets: (ticketNumbers) => request('/api/support-tickets/bulk-delete', { method: 'POST', body: JSON.stringify({ ticketNumbers }) }),
    downloadTicketAttachment: (ticketNumber, attachmentId, fileName) => download(`/api/support-tickets/${ticketNumber}/attachments/${attachmentId}`, fileName),
    internalChatThreads: () => request('/api/internal-chat'),
    createInternalChatThread: (data) => request('/api/internal-chat', { method: 'POST', body: JSON.stringify(data) }),
    getInternalChatThread: (id) => request(`/api/internal-chat/${id}`),
    replyInternalChatThread: (id, body) => request(`/api/internal-chat/${id}/replies`, { method: 'POST', body: JSON.stringify({ body }) })
};
