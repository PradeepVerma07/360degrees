import fetch from 'node-fetch';
import { expect } from 'chai';

const base = process.env.CI360_API_URL || 'http://localhost:4000';

describe('Productivity Role integration', function () {
  this.timeout(20000);

  it('fetches meta and posts a job with responsibilityKey', async () => {
    const metaRes = await fetch(`${base}/api/productivity/meta`);
    expect(metaRes.ok, 'meta fetch ok').to.be.true;
    const meta = await metaRes.json();
    expect(meta.clients && meta.clients.length, 'has clients').to.be.greaterThan(0);
    expect(meta.services && meta.services.length, 'has services').to.be.greaterThan(0);
    expect(meta.employees && meta.employees.length, 'has employees').to.be.greaterThan(0);
    const clientId = meta.clients[0].id;
    const serviceId = meta.services[0].id;
    const employees = meta.employees.slice(0, 2);
    const resps = meta.responsibilities || [];
    const assignments = employees.length === 1
      ? [{ userId: employees[0].id, revenuePercent: 100, hoursSpent: 2, responsibilityKey: resps[0]?.key || '' }]
      : [{ userId: employees[0].id, revenuePercent: 60, hoursSpent: 3, responsibilityKey: resps[0]?.key || '' }, { userId: employees[1].id, revenuePercent: 40, hoursSpent: 2, responsibilityKey: resps[1]?.key || '' }];
    const payload = { clientId, startDate: new Date().toISOString().slice(0,10), valueAmount: 1000, description: 'Mocha integration test job', serviceIds: [serviceId], assignments };
    const postRes = await fetch(`${base}/api/productivity/jobs`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
    const text = await postRes.text();
    expect(postRes.ok, `post status ${postRes.status}: ${text}`).to.be.true;
    const body = JSON.parse(text);
    expect(body.job, 'response has job').to.exist;
    expect(body.job.assignments && body.job.assignments.length, 'job has assignments').to.be.greaterThan(0);
    for (const a of body.job.assignments) {
      expect(a).to.have.property('responsibilityKey');
    }
  });
});
