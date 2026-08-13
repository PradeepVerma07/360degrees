package com.webtrionix.ci360;

import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String APP_USER_AGENT_TOKEN = "CI360AndroidApp";
    private static final String MOBILE_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final String APP_MODE_SCRIPT =
        "(function(){"
            + "window.__CI360_ANDROID_APP__=true;"
            + "window.__CI360_MOBILE_APP__=true;"
            + "function mark(){"
            + "var style=document.getElementById('ci360-apk-mobile-style');"
            + "if(!style&&document.head){style=document.createElement('style');style.id='ci360-apk-mobile-style';style.textContent='"
            + "html,body,#root{width:100%!important;max-width:100%!important;overflow-x:hidden!important;}"
            + ".dashboard-shell{max-width:100vw!important;overflow-x:hidden!important;}"
            + ".dashboard-shell.app-mobile-browser{display:block!important;grid-template-columns:1fr!important;width:100%!important;max-width:100vw!important;min-height:100dvh!important;overflow-x:hidden!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-main{width:100%!important;margin-left:0!important;padding-top:70px!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-topbar{position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;min-height:70px!important;padding:0 10px!important;z-index:80!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-search,.dashboard-shell.app-mobile-browser .dashboard-login-text,.dashboard-shell.app-mobile-browser .dashboard-topbar-left>div{display:none!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-menu,.dashboard-shell.app-mobile-browser .dashboard-notification,.dashboard-shell.app-mobile-browser .dashboard-theme-toggle{width:38px!important;min-height:38px!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-user-area{gap:6px!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-sidebar{position:fixed!important;left:0!important;top:0!important;width:286px!important;max-width:calc(100vw - 38px)!important;height:100dvh!important;padding-top:86px!important;z-index:100!important;overflow-y:auto!important;transform:translateX(-105%)!important;transition:transform 250ms ease!important;}"
            + ".dashboard-shell.app-mobile-browser.sidebar-open .dashboard-sidebar{transform:translateX(0)!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-content{width:100%!important;max-width:none!important;padding:12px!important;gap:12px!important;}"
            + ".dashboard-shell.app-mobile-browser .dashboard-stats,.dashboard-shell.app-mobile-browser .overview-metric-row,.dashboard-shell.app-mobile-browser .overview-analytics-grid,.dashboard-shell.app-mobile-browser .overview-lower-grid,.dashboard-shell.app-mobile-browser .overview-workload-grid,.dashboard-shell.app-mobile-browser .dashboard-work-grid,.dashboard-shell.app-mobile-browser .dashboard-work-right{grid-template-columns:1fr!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client{display:block!important;background:#f7f9fc!important;color:#15213b!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .dashboard-topbar,.dashboard-shell.app-mobile-browser.role-client .dashboard-sidebar,.dashboard-shell.app-mobile-browser.role-client .dashboard-backdrop{display:none!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .dashboard-main{width:100%!important;margin-left:0!important;padding-top:0!important;padding-bottom:calc(92px + env(safe-area-inset-bottom))!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .dashboard-content{padding:0 16px 18px!important;display:grid!important;gap:16px!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .overview-reference{display:block!important;width:100%!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .overview-reference>.overview-reference-head,.dashboard-shell.app-mobile-browser.role-client .overview-reference>.overview-metric-row,.dashboard-shell.app-mobile-browser.role-client .overview-reference>.overview-analytics-grid,.dashboard-shell.app-mobile-browser.role-client .overview-reference>.overview-workload-grid,.dashboard-shell.app-mobile-browser.role-client .overview-reference>.overview-lower-grid{display:none!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-header{display:grid!important;position:sticky!important;top:0!important;z-index:75!important;grid-template-columns:52px minmax(0,1fr) 42px 44px!important;align-items:center!important;gap:10px!important;padding:16px!important;background:#f7f9fc!important;border:0!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-logo{width:52px!important;height:52px!important;border-radius:18px!important;display:grid!important;place-items:center!important;background:#fff!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-logo img{width:42px!important;height:42px!important;object-fit:contain!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-greeting{min-width:0!important;display:grid!important;gap:3px!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-greeting strong{font-size:18px!important;line-height:1.18!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-greeting span{font-size:12px!important;color:#667085!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-icon-button,.dashboard-shell.app-mobile-browser.role-client .client-mobile-avatar{width:42px!important;min-height:42px!important;padding:0!important;border-radius:15px!important;display:grid!important;place-items:center!important;background:#fff!important;color:#15244a!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-avatar{border-radius:999px!important;background:#d0a936!important;color:#fff!important;font-size:13px!important;font-weight:900!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-overview{display:grid!important;gap:16px!important;width:100%!important;max-width:100%!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-hero{position:relative!important;min-height:210px!important;overflow:hidden!important;border-radius:24px!important;padding:24px!important;background:radial-gradient(circle at 88% 18%,rgba(80,143,255,.5),transparent 26%),linear-gradient(145deg,#102f74 0%,#071b49 58%,#041331 100%)!important;color:#fff!important;display:grid!important;grid-template-columns:minmax(0,1fr) 122px!important;align-items:center!important;gap:6px!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-hero h2{margin:0 0 10px!important;color:#fff!important;font-size:28px!important;line-height:1.05!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-hero p{margin:0!important;color:#dbe8ff!important;font-size:15px!important;line-height:1.5!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-kpis{display:flex!important;gap:10px!important;overflow-x:auto!important;margin:0 -16px!important;padding:2px 16px 8px!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-kpi{flex:0 0 106px!important;min-height:116px!important;padding:13px 12px!important;border-radius:18px!important;background:#fff!important;display:grid!important;gap:8px!important;text-align:left!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-kpi strong{font-size:25px!important;line-height:1!important;color:#101f3f!important;font-weight:900!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-kpi small{font-size:11px!important;line-height:1.25!important;color:#667085!important;font-weight:800!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-create{min-height:56px!important;width:100%!important;border:0!important;border-radius:17px!important;background:linear-gradient(90deg,#1455e8,#0847d8)!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;font-size:16px!important;font-weight:900!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-card{background:#fff!important;border-radius:22px!important;padding:18px!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-bottom-nav{display:flex!important;position:fixed!important;left:0!important;right:0!important;bottom:0!important;z-index:120!important;align-items:flex-start!important;justify-content:space-around!important;gap:2px!important;min-height:82px!important;margin:0!important;padding:10px 10px calc(10px + env(safe-area-inset-bottom))!important;border-radius:24px 24px 0 0!important;background:#fff!important;}"
            + ".dashboard-shell.app-mobile-browser.role-client .client-mobile-bottom-nav button{min-height:58px!important;flex:1!important;padding:4px 2px!important;border:0!important;border-radius:16px!important;background:transparent!important;color:#3e4859!important;display:grid!important;justify-items:center!important;align-content:center!important;gap:4px!important;font-size:10px!important;font-weight:900!important;}"
            + "';document.head.appendChild(style);}"
            + "document.documentElement.classList.add('ci360-android-app');"
            + "document.documentElement.classList.add('mobile-app-mode');"
            + "if(document.body){document.body.classList.add('ci360-android-app');}"
            + "if(document.body){document.body.classList.add('mobile-app-mode');}"
            + "document.querySelectorAll('.dashboard-shell').forEach(function(node){node.classList.add('app-mobile-browser');});"
            + "}"
            + "var meta=document.querySelector('meta[name=\"viewport\"]');"
            + "if(!meta&&document.head){meta=document.createElement('meta');meta.name='viewport';document.head.appendChild(meta);}"
            + "if(meta){meta.setAttribute('content','width=device-width,initial-scale=1.0,maximum-scale=1.0,viewport-fit=cover');}"
            + "try{localStorage.setItem('ci360-platform','android');}catch(e){}"
            + "mark();"
            + "try{new MutationObserver(mark).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}"
            + "})();";

    private boolean mobileWebViewConfigured = false;

    @Override
    protected void load() {
        super.load();
        configureMobileBrowserWebView();
    }

    private void configureMobileBrowserWebView() {
        if (mobileWebViewConfigured || getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        mobileWebViewConfigured = true;

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setUserAgentString(MOBILE_USER_AGENT + " " + APP_USER_AGENT_TOKEN + " Mobile");
        webView.clearCache(true);
        webView.setInitialScale(100);

        webView.postDelayed(() -> {
            webView.evaluateJavascript(APP_MODE_SCRIPT, null);
        }, 250);
    }
}
