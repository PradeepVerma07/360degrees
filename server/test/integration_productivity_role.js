import fetch from 'node-fetch';
import fs from 'fs';

const base = process.env.CI360_API_URL || 'http://localhost:4000';
console.log('Using API base', base);

async function getMeta() {
  const res = await fetch(`${base}/api/productivity/meta`, { method: 'GET' });
  if (!res.ok) throw new Error('Meta fetch failed: ' + await res.text());
  return res.json();
}

async function postJob(payload) {
  const res = await fetch(`${base}/api/productivity/jobs`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error('Job post failed: ' + text);
  return JSON.parse(text);
}

(async function run() {
  try {
    const meta = await getMeta();
    if (!meta.clients || !meta.clients.length) throw new Error('No clients');
    if (!meta.services || !meta.services.length) throw new Error('No services');
    if (!meta.employees || !meta.employees.length) throw new Error('No employees');
    const clientId = meta.clients[0].id;
    const serviceId = meta.services[0].id;
    const employees = meta.employees.slice(0, 2);
    const resps = meta.responsibilities || [];
    const assignments = employees.length === 1 ? [ { userId: employees[0].id, revenuePercent: 100, hoursSpent: 2, responsibilityKey: resps[0]?.key || '' } ] : [ { userId: employees[0].id, revenuePercent: 60, hoursSpent: 3, responsibilityKey: resps[0]?.key || '' }, { userId: employees[1].id, revenuePercent: 40, hoursSpent: 2, responsibilityKey: resps[1]?.key || '' } ];
    const payload = { clientId, startDate: new Date().toISOString().slice(0,10), valueAmount: 1000, description: 'Integration test job', serviceIds: [serviceId], assignments };
    console.log('Posting payload', JSON.stringify(payload));
    const resp = await postJob(payload);
    console.log('Success', JSON.stringify(resp, null, 2));
  } catch (err) {
    console.error('Integration test failed', err.message, err.stack);
    process.exit(2);
  }
})();
