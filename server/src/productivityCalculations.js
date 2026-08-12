const dayMs = 24 * 60 * 60 * 1000;
const isoDate = date => date.toISOString().slice(0, 10);
const dateOnly = value => {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()))
    return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const clampDate = (date, min, max) => new Date(Math.min(Math.max(date.getTime(), min.getTime()), max.getTime()));

export function getTrackingStart(today = new Date()) {
  const date = dateOnly(today);
  const year = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return isoDate(new Date(Date.UTC(year, 6, 1)));
}

export function getTrackingEnd(today = new Date()) {
  return isoDate(dateOnly(today));
}

export function daysBetweenInclusive(from, to) {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (!start || !end || end < start)
    return 0;
  return Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
}

export function weeksBetween(from, to) {
  return Math.max(daysBetweenInclusive(from, to) / 7, 1 / 7);
}

export function resolvePeriodRange(period = 'all', from = '', to = '', today = new Date()) {
  const key = String(period || 'all').toLowerCase();
  const trackingStart = dateOnly(getTrackingStart(today));
  const trackingEnd = dateOnly(getTrackingEnd(today));
  const now = dateOnly(today);
  let start = trackingStart;
  let end = trackingEnd;

  if (key === 'today') {
    start = now;
    end = now;
  } else if (key === 'month') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (key === 'last30') {
    start = new Date(now.getTime() - 29 * dayMs);
  } else if (key === 'quarter') {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
  } else if (key === 'custom') {
    start = dateOnly(from) || trackingStart;
    end = dateOnly(to) || trackingEnd;
  }

  start = clampDate(start, trackingStart, trackingEnd);
  end = clampDate(end, trackingStart, trackingEnd);
  if (end < start)
    end = start;
  return { key, from: isoDate(start), to: isoDate(end), trackingStart: isoDate(trackingStart), trackingEnd: isoDate(trackingEnd) };
}

export function currentPeriodRange(period, today = new Date()) {
  const now = dateOnly(today);
  if (period === 'day')
    return { from: isoDate(now), to: isoDate(now) };
  if (period === 'week') {
    const day = now.getUTCDay() || 7;
    const start = new Date(now.getTime() - (day - 1) * dayMs);
    return { from: isoDate(start), to: isoDate(now) };
  }
  return { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: isoDate(now) };
}

export function reportRanges(today = new Date()) {
  const now = dateOnly(today);
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonthLastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  const matchingPreviousDay = Math.min(now.getUTCDate(), previousMonthLastDay);
  return {
    mtd: { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: isoDate(now) },
    ytd: { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: isoDate(now) },
    lmtd: { from: isoDate(previousMonth), to: isoDate(new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), matchingPreviousDay))) },
    lytd: { from: isoDate(new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))), to: isoDate(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))) }
  };
}

export function calculateUtilization(hours, weeklyCapacity, weeks) {
  const capacityHours = Number(weeklyCapacity || 0) * Number(weeks || 0);
  if (!capacityHours)
    return 0;
  return Number(hours || 0) / capacityHours * 100;
}

export function getUtilizationStatus(value) {
  const utilization = Number(value || 0);
  if (utilization >= 115)
    return 'overworked';
  if (utilization >= 90)
    return 'stretched';
  if (utilization >= 55)
    return 'balanced';
  if (utilization >= 25)
    return 'underutilised';
  return 'idle';
}

export function calculateRevenueCredit(jobValue, percent) {
  return Number(jobValue || 0) * Number(percent || 0) / 100;
}

export function calculateProductivityTat(startDate, completionDate) {
  if (!completionDate)
    return null;
  const start = dateOnly(startDate);
  const end = dateOnly(completionDate);
  if (!start || !end)
    return null;
  return Math.round((end.getTime() - start.getTime()) / dayMs);
}

export function calculateTargetPace(actual, target) {
  const goal = Number(target || 0);
  if (!goal)
    return 'off_pace';
  const ratio = Number(actual || 0) / goal;
  if (ratio >= 1)
    return 'on_pace';
  if (ratio >= 0.6)
    return 'behind';
  return 'off_pace';
}

export function growthPercent(current, previous) {
  const next = Number(current || 0);
  const prior = Number(previous || 0);
  if (!prior)
    return next ? 100 : 0;
  return (next - prior) / prior * 100;
}

export function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function buildProductivityInsights({ people = [], services = [], rosterLoad = [], clientConcentration = [] }) {
  const insights = [];
  for (const person of people) {
    if (person.utilization >= 115) {
      insights.push({
        type: 'overworked',
        severity: 'critical',
        userId: person.id,
        title: `${person.name} is over capacity`,
        message: `${person.name} is running at ${person.utilization.toFixed(0)}% of capacity. Consider redistributing work, adding backup support, or hiring for this service area.`
      });
    } else if (person.utilization < 55 && person.hours > 0) {
      insights.push({
        type: 'underutilised',
        severity: 'warning',
        userId: person.id,
        title: `${person.name} has spare capacity`,
        message: `${person.name} is at ${person.utilization.toFixed(0)}% utilization. Consider assigning more accounts, cross-training, or redistributing incoming work.`
      });
    } else if (!person.hours) {
      insights.push({
        type: 'no_activity',
        severity: 'info',
        userId: person.id,
        title: `${person.name} has no logged work`,
        message: `No productivity work has been logged for ${person.name} in this period.`
      });
    }
  }
  for (const service of services) {
    if (service.contributors?.length === 1) {
      const owner = people.find(person => person.id === service.contributors[0]);
      if (owner && owner.utilization >= 90) {
        insights.push({
          type: 'single_point_of_failure',
          severity: owner.utilization >= 115 ? 'critical' : 'warning',
          userId: owner.id,
          title: `${service.name} has a single point of failure`,
          message: `${owner.name} is the only active contributor for ${service.name} and is ${owner.statusLabel.toLowerCase()}. Add backup support for continuity.`
        });
      }
    }
  }
  for (const load of rosterLoad) {
    if (load.accountCount >= 5 || load.difficultySum >= 24) {
      insights.push({
        type: 'heavy_account_oversight',
        severity: 'warning',
        userId: load.userId,
        title: `${load.name} carries heavy account oversight`,
        message: `${load.name} appears on ${load.accountCount} account roster${load.accountCount === 1 ? '' : 's'} with combined difficulty ${load.difficultySum}.`
      });
    }
  }
  const topClient = clientConcentration[0];
  if (topClient && topClient.percent >= 40) {
    insights.push({
      type: 'client_concentration',
      severity: 'warning',
      clientId: topClient.clientId,
      title: `${topClient.clientName} concentration risk`,
      message: `${topClient.clientName} represents ${topClient.percent.toFixed(0)}% of tracked revenue in this period.`
    });
  }
  return insights.slice(0, 12);
}
