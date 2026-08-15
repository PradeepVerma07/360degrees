import express from 'express';
import { requirePermission, requireInternalUser } from '../permissions.js';
import { resolvePeriodRange } from '../utils/productivityDates.js';
import { ProductivityService } from '../services/productivityService.js';

export function createProductivityRouter(io) {
  const router = express.Router();

  // All productivity routes require internal user authentication and base permission
  router.use(requireInternalUser);
  router.use(requirePermission('productivity.view'));

  // 1. Dashboard
  router.get('/dashboard', requirePermission('productivity.dashboard.view'), async (req, res) => {
    try {
      const range = resolvePeriodRange(req.query);
      const dashboard = await ProductivityService.getDashboard({ userContext: req.user, range });
      res.json(dashboard);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Analysis
  router.get('/analysis', requirePermission('productivity.analysis.view'), async (req, res) => {
    try {
      const range = resolvePeriodRange(req.query);
      const analysis = await ProductivityService.getAnalysis({ userContext: req.user, range });
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Accounts Roster
  router.get('/accounts', requirePermission('productivity.accounts.view'), async (req, res) => {
    try {
      const data = await ProductivityService.getAccountsRoster();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/accounts', requirePermission('productivity.accounts.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveAccountRoster({ userContext: req.user, payload: req.body });
      io?.emit('productivity:changed', { entity: 'roster' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/accounts/reassign', requirePermission('productivity.accounts.manage'), async (req, res) => {
    try {
      const { fromUserId, toUserId, markInactive } = req.body;
      if (!fromUserId || !toUserId) return res.status(400).json({ error: 'Both from and to user are required' });
      const result = await ProductivityService.reassignPersonAccounts({
        userContext: req.user,
        fromUserId,
        toUserId,
        markInactive
      });
      io?.emit('productivity:changed', { entity: 'roster' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Targets
  router.get('/targets', requirePermission('productivity.targets.view'), async (req, res) => {
    try {
      const targets = await ProductivityService.getTargets();
      res.json(targets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/targets', requirePermission('productivity.targets.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveTarget({ userContext: req.user, payload: req.body });
      io?.emit('productivity:changed', { entity: 'target' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/targets/:id', requirePermission('productivity.targets.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveTarget({ userContext: req.user, payload: req.body, id: req.params.id });
      io?.emit('productivity:changed', { entity: 'target' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/targets/:id', requirePermission('productivity.targets.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.deleteTarget({ userContext: req.user, id: req.params.id });
      io?.emit('productivity:changed', { entity: 'target' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Reports
  router.get('/reports', requirePermission('productivity.reports.view'), async (req, res) => {
    try {
      const serviceId = req.query.serviceId ? Number(req.query.serviceId) : null;
      const reports = await ProductivityService.getReports({ serviceId });
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Daily Log
  router.get('/daily-log', requirePermission('productivity.daily_log.view'), async (req, res) => {
    try {
      const range = resolvePeriodRange(req.query);
      const log = await ProductivityService.getDailyLog({ range });
      res.json(log);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. By Client
  router.get('/by-client', requirePermission('productivity.by_client.view'), async (req, res) => {
    try {
      const range = resolvePeriodRange(req.query);
      const list = await ProductivityService.getByClient({ range });
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. By Person
  router.get('/by-person', requirePermission('productivity.by_person.view'), async (req, res) => {
    try {
      const range = resolvePeriodRange(req.query);
      const hasSalaryViewPermission = req.user?.permissions?.includes('productivity.salaries.view') || false;
      const list = await ProductivityService.getByPerson({
        range,
        viewerUserId: req.user.id,
        hasSalaryViewPermission
      });
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Jobs CRUD
  router.get('/jobs', requirePermission('productivity.jobs.view'), async (req, res) => {
    try {
      const range = req.query.period ? resolvePeriodRange(req.query) : null;
      const jobs = await ProductivityService.getJobs({
        range,
        status: req.query.status,
        clientId: req.query.clientId
      });
      res.json(jobs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/jobs', requirePermission('productivity.jobs.create'), async (req, res) => {
    try {
      const result = await ProductivityService.createJob({ userContext: req.user, payload: req.body });
      io?.emit('productivity:changed', { entity: 'job', id: result.id });
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/jobs/:id', requirePermission('productivity.jobs.edit'), async (req, res) => {
    try {
      const result = await ProductivityService.updateJob({ userContext: req.user, id: req.params.id, payload: req.body });
      io?.emit('productivity:changed', { entity: 'job', id: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/jobs/:id', requirePermission('productivity.jobs.delete'), async (req, res) => {
    try {
      const result = await ProductivityService.deleteJob({ userContext: req.user, id: req.params.id });
      io?.emit('productivity:changed', { entity: 'job', id: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Services
  router.get('/services', async (req, res) => {
    try {
      const services = await ProductivityService.getServices();
      res.json(services);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/services', requirePermission('productivity.services.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveService({ userContext: req.user, payload: req.body });
      io?.emit('productivity:changed', { entity: 'service' });
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/services/:id', requirePermission('productivity.services.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveService({ userContext: req.user, payload: req.body, id: req.params.id });
      io?.emit('productivity:changed', { entity: 'service' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/services/:id', requirePermission('productivity.services.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.deleteService({ userContext: req.user, id: req.params.id });
      io?.emit('productivity:changed', { entity: 'service' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Salary Grades & Assignments (Private)
  router.get('/salary-grades', requirePermission('productivity.salaries.view'), async (req, res) => {
    try {
      const data = await ProductivityService.getSalaryGrades({ userContext: req.user });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/salary-grades', requirePermission('productivity.salaries.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveSalaryGrade({ userContext: req.user, payload: req.body });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/salary-grades/:id', requirePermission('productivity.salaries.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.saveSalaryGrade({ userContext: req.user, payload: req.body, id: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/salary-assignments/:employeeId', requirePermission('productivity.salaries.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.assignSalaryGrade({
        userContext: req.user,
        employeeId: req.params.employeeId,
        gradeId: req.body.gradeId
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12. Employee Settings (Capacity & Status)
  router.get('/settings', requirePermission('productivity.settings.manage'), async (req, res) => {
    try {
      const settings = await ProductivityService.getEmployeeSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/settings/:userId', requirePermission('productivity.settings.manage'), async (req, res) => {
    try {
      const result = await ProductivityService.updateEmployeeSetting({
        userContext: req.user,
        userId: req.params.userId,
        payload: req.body
      });
      io?.emit('productivity:changed', { entity: 'setting' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 13. Data Export
  router.get('/export', requirePermission('productivity.export'), async (req, res) => {
    try {
      const data = await ProductivityService.exportData({ userContext: req.user });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
