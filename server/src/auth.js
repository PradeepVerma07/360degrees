import jwt from 'jsonwebtoken';
import { hasAnyPermission, loadUserContext } from './permissions.js';

const secret = () => process.env.JWT_SECRET || 'development-only-secret';
export const signToken = (user) => jwt.sign(user, secret(), { expiresIn: '12h' });
export async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
        return res.status(401).json({ error: 'Authentication required' });
    try {
        const tokenUser = jwt.verify(header.slice(7), secret());
        const user = await loadUserContext(tokenUser.id);
        if (!user)
            return res.status(401).json({ error: 'Session expired or invalid' });
        req.user = user;
        next();
    }
    catch {
        return res.status(401).json({ error: 'Session expired or invalid' });
    }
}
export function requireAdmin(req, res, next) {
    if (!hasAnyPermission(req.user, ['jobs.view_all', 'clients.view_all', 'settings.edit', 'support.view_all']))
        return res.status(403).json({ error: 'Admin access required' });
    next();
}
