import React, { useRef, useEffect } from 'react';
import DashboardIcon from './DashboardIcon';
import SidebarItem from './SidebarItem';

export default function DashboardSidebar({ tabs, tab, goTo, dashboardProfile, avatarInitials, displayName, displayRole, logout, runSidebarAction, sidebarOpen, setSidebarOpen }) {
  const containerRef = useRef(null);

  const onKeyDown = (e) => {
    if (!containerRef.current) return;
    const buttons = Array.from(containerRef.current.querySelectorAll('button'));
    if (!buttons.length) return;
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx === -1 || idx === buttons.length - 1 ? 0 : idx + 1;
      buttons[next].focus();
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx <= 0 ? buttons.length - 1 : idx - 1;
      buttons[prev].focus();
    }
    else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0].focus();
    }
    else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1].focus();
    }
    else if (e.key === 'Enter' || e.key === ' ') {
      // activate the currently focused sidebar item if it has a data-sidebar-id
      const id = document.activeElement?.dataset?.sidebarId;
      if (id) {
        e.preventDefault();
        goTo(id);
      }
    }
  };

  return (
    <aside id="dashboard-sidebar" className="dashboard-sidebar" aria-label="Dashboard navigation">
      <div className="dashboard-brand dashboard-brand-icon-only">
        <img src="/assets/ci360-logo-mark.png" alt="CI360degrees" />
        <div className="dashboard-brand-copy">
          <strong>CI360degrees</strong>
          <small>Realtime Job Board</small>
        </div>
        <button type="button" className="dashboard-collapse-toggle" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setSidebarOpen(open => !open)}>
          <DashboardIcon name="chevron" />
        </button>
      </div>

      <div className="dashboard-nav" role="navigation" aria-label="Dashboard tabs" ref={navRef => (containerRef.current = navRef)} onKeyDown={onKeyDown} tabIndex={0}>
        <button type="button" className="dashboard-sidebar-primary" onClick={() => goTo('submit')}>
          <DashboardIcon name="plus" />
          <span>+ Submit a Job</span>
        </button>

        {tabs.map(([id, label]) => (
          <SidebarItem key={id} id={id} label={label} active={tab === id} onActivate={goTo} icon={id === 'overview' ? 'overview' : id} description={'Open section'} count={undefined} />
        ))}
      </div>

      <div className="dashboard-sidebar-spacer" aria-hidden="true" />

      <div className="dashboard-sidebar-footer">
        <div className="dashboard-sidebar-profile">
          <span className="dashboard-avatar">{avatarInitials}</span>
          <div><b>{displayName}</b><small>{displayRole}</small></div>
        </div>
        <button type="button" className="dashboard-sidebar-logout" onClick={logout}><DashboardIcon name="logout" /><span>Logout</span></button>
      </div>
    </aside>
  );
}
