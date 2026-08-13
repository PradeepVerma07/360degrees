import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyForcedMobileAppMode, isForcedMobileAppMode } from './mobileMode';

if (isForcedMobileAppMode()) {
    applyForcedMobileAppMode();
    try {
        new MutationObserver(applyForcedMobileAppMode).observe(document.documentElement, { childList: true, subtree: true });
    }
    catch {
    }
}

ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
