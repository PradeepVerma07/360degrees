import React from 'react';
import DashboardIcon from './DashboardIcon';

export default function SidebarItem({ id, label, active, onActivate, icon, description, count }) {
  return (
    <button type="button" className={active ? 'active' : ''} onClick={() => onActivate(id)} data-sidebar-id={id}>
      <DashboardIcon name={icon || 'overview'} />
      <span>
        <b>{label}</b>
        <small>{description || ''}</small>
      </span>
      {typeof count === 'number' && count > 0 && <em className="sidebar-count">{Math.min(count,99)}</em>}
    </button>
  );
}
