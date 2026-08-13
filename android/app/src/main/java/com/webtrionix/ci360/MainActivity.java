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
        settings.setUserAgentString(MOBILE_USER_AGENT + " " + APP_USER_AGENT_TOKEN + " Mobile");
        webView.clearCache(true);
        webView.setInitialScale(100);

        webView.postDelayed(() -> {
            webView.evaluateJavascript(APP_MODE_SCRIPT, null);
        }, 250);
    }
}
