import React from 'react';
import DashboardIcon from './DashboardIcon';

export default function DashboardTopbar({ activeLabel, dashboardProfile, sidebarOpen, setSidebarOpen, searchTerm, setSearchTerm, submitSearch, unreadNotifications, notificationOpen, setNotificationOpen, notificationItems, logout, userMenuOpen, setUserMenuOpen, theme, setTheme, goTo }) {
  return (
    <div className="dashboard-topbar">
      <div className="dashboard-topbar-left">
        <button type="button" className="dashboard-menu" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} aria-controls="dashboard-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}>
          <DashboardIcon name="menu" />
        </button>
        <div>
          <span>{activeLabel}</span>
          <strong>{dashboardProfile.workspaceTitle}</strong>
        </div>
      </div>
      <form className="dashboard-search" role="search" onSubmit={submitSearch}>
        <DashboardIcon name="search" />
        <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search..." aria-label="Search jobs" />
        <button type="submit" aria-label="Open job search"><DashboardIcon name="search" /></button>
      </form>
      <div className="dashboard-user-area">
        <button type="button" className="dashboard-theme-toggle" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}><DashboardIcon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
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
            <span>{dashboardProfile?.displayName || ''}</span>
            <DashboardIcon name="chevron" />
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
