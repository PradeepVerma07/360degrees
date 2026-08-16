/**
 * Productivity Intelligence — Date & Reporting Cycle Utilities
 */

export function getTrackingStart(now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0 = Jan, 6 = July
  const startYear = currentMonth >= 6 ? currentYear : currentYear - 1;
  return new Date(startYear, 6, 1, 0, 0, 0, 0); // 1 July 00:00:00
}

export function getTrackingEnd(now = new Date()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function formatDateYMD(d) {
  if (!d) return '';
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolvePeriodRange(query = {}, now = new Date()) {
  const period = (query.period || 'month').toLowerCase();
  const trackingStart = getTrackingStart(now);
  const trackingEnd = getTrackingEnd(now);

  let from = new Date(now);
  let to = new Date(now);
  to.setHours(23, 59, 59, 999);

  switch (period) {
    case 'all_time':
    case 'all':
      from = new Date(trackingStart);
      to = new Date(trackingEnd);
      break;

    case 'today':
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      break;

    case 'this_month':
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;

    case 'last_30_days':
    case 'last30':
      from = new Date(now);
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      break;

    case 'this_quarter':
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), qMonth, 1, 0, 0, 0, 0);
      break;
    }

    case 'custom':
      if (query.from) {
        from = new Date(query.from);
        from.setHours(0, 0, 0, 0);
      } else {
        from = new Date(trackingStart);
      }
      if (query.to) {
        to = new Date(query.to);
        to.setHours(23, 59, 59, 999);
      } else {
        to = new Date(trackingEnd);
      }
      break;

    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
  }

  // Bound from to tracking start if earlier, unless specifically requesting custom historical analysis
  if (from < trackingStart && period !== 'custom') {
    from = new Date(trackingStart);
  }

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const weeks = Math.max(days / 7, 1 / 7);
  const months = Math.max(weeks / 4.345, 1 / 30);

  return {
    key: period,
    from: formatDateYMD(from),
    to: formatDateYMD(to),
    fromDate: from,
    toDate: to,
    days,
    weeks,
    months
  };
}

export function getComparativeReportRanges(now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDate = now.getDate();

  // MTD: First day of current month -> Today
  const mtdFrom = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
  const mtdTo = new Date(now);
  mtdTo.setHours(23, 59, 59, 999);

  // YTD: Jan 1 of current year -> Today
  const ytdFrom = new Date(currentYear, 0, 1, 0, 0, 0, 0);
  const ytdTo = new Date(now);
  ytdTo.setHours(23, 59, 59, 999);

  // LMTD: First day of previous month -> matching day of previous month
  const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const prevMonthYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();
  const daysInPrevMonth = new Date(prevMonthYear, prevMonth + 1, 0).getDate();
  const lmtdDay = Math.min(currentDate, daysInPrevMonth);
  const lmtdFrom = new Date(prevMonthYear, prevMonth, 1, 0, 0, 0, 0);
  const lmtdTo = new Date(prevMonthYear, prevMonth, lmtdDay, 23, 59, 59, 999);

  // LYTD: Jan 1 previous year -> equivalent previous-year date
  const prevYear = currentYear - 1;
  const daysInPrevYearFeb = new Date(prevYear, 2, 0).getDate();
  let lytdDay = currentDate;
  if (currentMonth === 1 && currentDate === 29 && daysInPrevYearFeb === 28) {
    lytdDay = 28;
  }
  const lytdFrom = new Date(prevYear, 0, 1, 0, 0, 0, 0);
  const lytdTo = new Date(prevYear, currentMonth, lytdDay, 23, 59, 59, 999);

  return {
    mtd: { from: formatDateYMD(mtdFrom), to: formatDateYMD(mtdTo), fromDate: mtdFrom, toDate: mtdTo },
    ytd: { from: formatDateYMD(ytdFrom), to: formatDateYMD(ytdTo), fromDate: ytdFrom, toDate: ytdTo },
    lmtd: { from: formatDateYMD(lmtdFrom), to: formatDateYMD(lmtdTo), fromDate: lmtdFrom, toDate: lmtdTo },
    lytd: { from: formatDateYMD(lytdFrom), to: formatDateYMD(lytdTo), fromDate: lytdFrom, toDate: lytdTo }
  };
}
