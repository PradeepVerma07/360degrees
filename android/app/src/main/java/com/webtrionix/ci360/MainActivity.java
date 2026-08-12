package com.webtrionix.ci360;

import android.os.Bundle;
import android.webkit.WebStorage;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        WebView webView = new WebView(this);
        webView.clearCache(true);
        webView.clearHistory();
        webView.destroy();
        WebStorage.getInstance().deleteAllData();
        super.onCreate(savedInstanceState);
    }
}
