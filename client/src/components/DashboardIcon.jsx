import React from 'react';

export default function DashboardIcon({ name }) {
  const paths = {
    overview: ['M4 13h6V4H4z', 'M14 20h6v-9h-6z', 'M4 20h6v-4H4z', 'M14 8h6V4h-6z'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    search: ['M21 21l-4.35-4.35', 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z'],
    bell: ['M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z', 'M10 20a2 2 0 0 0 4 0'],
    logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M21 3v18h-6'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-5'],
    chevron: ['M9 6l6 6-6 6'],
    plus: ['M12 5v14', 'M5 12h14'],
    document: ['M7 3h7l5 5v13H7z', 'M14 3v6h5', 'M10 14h6', 'M10 18h4']
  };
  const list = paths[name] || paths.overview;
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {list.map((d, i) => <path d={d} key={i} />)}
    </svg>
  );
}
