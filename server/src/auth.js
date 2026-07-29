import jwt from 'jsonwebtoken';
const secret = () => process.env.JWT_SECRET || 'development-only-secret';
export const signToken = (user) => jwt.sign(user, secret(), { expiresIn: '12h' });
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
        return res.status(401).json({ error: 'Authentication required' });
    try {
        req.user = jwt.verify(header.slice(7), secret());
        next();
    }
    catch {
        return res.status(401).json({ error: 'Session expired or invalid' });
    }
}
export function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin')
        return res.status(403).json({ error: 'Admin access required' });
    next();
}
