export function isForcedMobileAppMode() {
    if (typeof window === 'undefined')
        return false;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mobileApp') === '1')
            return true;
    }
    catch {
    }

    return window.__CI360_MOBILE_APP__ === true
        || window.location.protocol === 'capacitor:'
        || window.location.protocol === 'file:';
}

export function applyForcedMobileAppMode() {
    if (typeof document === 'undefined')
        return;

    document.documentElement.classList.add('mobile-app-mode');
    document.body?.classList.add('mobile-app-mode');
    document.querySelectorAll('.dashboard-shell').forEach(node => {
        node.classList.add('app-mobile-browser');
    });
}
