export const priorityMultiplier = { Urgent: 0.5, High: 0.75, Medium: 1, Low: 1.5 };
export function calculateHours(settings, categoryLoad, category, priority) {
    const categoryDef = settings.categories.find((item) => item.name === category) || settings.categories[0];
    const pending = categoryLoad[category] || 0;
    const overCapacity = Math.max(0, pending - settings.capacityPerCategory);
    return Math.round(categoryDef.baseHours * (priorityMultiplier[priority] ?? 1) + overCapacity * settings.bufferHoursPerExtraJob);
}
