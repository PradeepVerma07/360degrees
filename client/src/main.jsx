import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';

const params = new URLSearchParams(window.location.search);
const forceMobileApp = params.get('mobileApp') === '1' || Capacitor.isNativePlatform();
if (forceMobileApp) {
    document.documentElement.classList.add('mobile-app-mode');
    document.body.classList.add('mobile-app-mode');
}

ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
