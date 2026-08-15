export function addWorkingHours(startDate, hours, settings) { let current = new Date(startDate); const setHour = (d, decimal) => { const copy = new Date(d); copy.setHours(Math.floor(decimal), Math.round((decimal % 1) * 60), 0, 0); return copy; }; const isWorkDay = (d) => settings.workDays.includes(d.getDay()); const nextStart = (d) => { let n = new Date(d); n.setDate(n.getDate() + 1); n = setHour(n, settings.startHour); while (!isWorkDay(n))
    n.setDate(n.getDate() + 1); return n; }; let start = setHour(current, settings.startHour), end = setHour(current, settings.endHour); if (!isWorkDay(current))
    current = nextStart(new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1));
else if (current < start)
    current = start;
else if (current >= end)
    current = nextStart(current); let remaining = hours; while (remaining > 0) {
    end = setHour(current, settings.endHour);
    const available = (end.getTime() - current.getTime()) / 3600000;
    if (remaining <= available) {
        current = new Date(current.getTime() + remaining * 3600000);
        remaining = 0;
    }
    else {
        remaining -= available;
        current = nextStart(current);
    }
} return current; }
