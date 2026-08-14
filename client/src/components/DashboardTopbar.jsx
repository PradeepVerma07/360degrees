import React from 'react';
import DashboardIcon from './DashboardIcon';

export default function DashboardTopbar({ activeLabel, dashboardProfile, sidebarOpen, setSidebarOpen, searchTerm, setSearchTerm, submitSearch, unreadNotifications, notificationOpen, setNotificationOpen, notificationItems, logout, userMenuOpen, setUserMenuOpen, theme, setTheme, goTo }) {
  return (
    <div className="dashboard-topbar">
      <div className="dashboard-topbar-left">
        <button type="button" className="dashboard-menu" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} aria-controls="dashboard-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}>
          <DashboardIcon name="menu" />
        </button>
        <div className="dashboard-page-heading">
          <span>{activeLabel}</span>
          <strong>{activeLabel === 'Overview' ? 'Realtime visibility across jobs, workload and delivery timelines.' : 'CI360 Job Board'}</strong>
        </div>
      </div>

      <div className="dashboard-topbar-right">
        <div className="dashboard-realtime-status">
          <span className="dashboard-status-dot" aria-hidden="true" />
          <span>Realtime Connected</span>
        </div>

        <div className="dashboard-workspace">
          <small>Workspace</small>
          <strong>CI360 Job Board</strong>
        </div>

        <div className="dashboard-notification-wrap">
          <button type="button" className="dashboard-notification" aria-label="Open notifications" aria-expanded={notificationOpen} onClick={() => { setNotificationOpen(open => !open); setUserMenuOpen(false); }}>
            <DashboardIcon name="bell" />{unreadNotifications > 0 && <span>{unreadNotifications}</span>}
          </button>
          {notificationOpen && (
            <div className="dashboard-notification-menu" role="dialog" aria-label="Notifications">
              <div className="dashboard-notification-head"><b>Notifications</b><span>{unreadNotifications} unread update{unreadNotifications === 1 ? '' : 's'}</span></div>
              {notificationItems.length ? <div className="dashboard-activity-list compact">{notificationItems.map(item => <button key={item.id} className={`dashboard-activity ${item.tone}`} onClick={() => goTo(item.tab)}><span className="dashboard-activity-dot" /><span><b>{item.description}</b><small>{item.support}</small></span></button>)}</div> : <div className="dashboard-empty"><b>No notifications</b><p>Job, ticket, and team chat updates will appear here.</p></div>}
              <button type="button" className="dashboard-open-overview" onClick={() => goTo('notifications')}>Open Notifications</button>
            </div>
          )}
        </div>

        <div className="dashboard-user-menu-wrap">
          <button type="button" className="dashboard-user-button" aria-expanded={userMenuOpen} onClick={() => { setUserMenuOpen(open => !open); setNotificationOpen(false); }}>
            <span className="dashboard-avatar">{dashboardProfile?.avatarInitials || ''}</span>
          </button>
          {userMenuOpen && (
            <div className="dashboard-user-menu" role="menu">
              <div><b>{dashboardProfile?.displayName}</b><span>{dashboardProfile?.displayRole}</span></div>
              <button type="button" role="menuitem" onClick={logout}>Log out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
