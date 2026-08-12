import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { IS_NATIVE_APP } from './api';

if (IS_NATIVE_APP) {
    document.documentElement.classList.add('ci360-native-app');
    document.body.classList.add('ci360-native-app');
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=430,initial-scale=1.0,maximum-scale=1.0,viewport-fit=cover');
}

ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
