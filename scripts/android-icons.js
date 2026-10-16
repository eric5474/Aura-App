#!/usr/bin/env node
'use strict';
/* Puts the AURA logo on the Android launcher icon and splash screen.
   Run after `npx cap add android`. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const icons = path.join(root, 'resources', 'android');
if (!fs.existsSync(res)) { console.error('android/ not found. Run `npx cap add android` first.'); process.exit(1); }

// launcher icons for every screen density
for (const dir of fs.readdirSync(icons)) {
  const from = path.join(icons, dir);
  if (!fs.statSync(from).isDirectory()) continue;
  const to = path.join(res, dir);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
// use the full-bleed logo instead of Android's adaptive icon template
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });

// splash screen: replace every splash.png the template ships with
let n = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f === 'splash.png') { fs.copyFileSync(path.join(icons, 'splash.png'), p); n++; }
  }
})(res);

// status bar and window colours to match the app
const values = path.join(res, 'values');
const colors = path.join(values, 'colors.xml');
fs.mkdirSync(values, { recursive: true });
let xml = fs.existsSync(colors) ? fs.readFileSync(colors, 'utf8') : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
const set = (name, val) => {
  const re = new RegExp(`<color name="${name}">[^<]*</color>`);
  xml = re.test(xml) ? xml.replace(re, `<color name="${name}">${val}</color>`) : xml.replace('</resources>', `    <color name="${name}">${val}</color>\n</resources>`);
};
set('colorPrimary', '#111514'); set('colorPrimaryDark', '#111514'); set('colorAccent', '#3AC9BE');
fs.writeFileSync(colors, xml);

// Let songs start without waiting for a tap (Android's web view blocks audio that starts after a delay otherwise)
const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkgDir = path.join(root, 'android', 'app', 'src', 'main', 'java', ...cap.appId.split('.'));
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(pkgDir, 'MainActivity.java'), `package ${cap.appId};

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    private boolean ready = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JioLoginPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (ready || getBridge() == null || getBridge().getWebView() == null) return;
        ready = true;
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Song audio is only served to requests that come from the JioSaavn web player, so add the
        // same Referer that player sends. Everything else goes through Capacitor as usual.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String host = u.getHost(), p = u.getPath();
                boolean audio = host != null && host.endsWith("saavncdn.com") && p != null && (p.endsWith(".mp4") || p.endsWith(".m4a"));
                if (audio && "GET".equalsIgnoreCase(request.getMethod())) {
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(u.toString()).openConnection();
                        for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
                        c.setRequestProperty("Referer", "https://www.jiosaavn.com/");
                        c.setRequestProperty("Origin", "https://www.jiosaavn.com");
                        int code = c.getResponseCode();
                        String reason = c.getResponseMessage();
                        if (reason == null || reason.isEmpty()) reason = code < 300 ? "OK" : "Error";
                        Map<String, String> out = new HashMap<>();
                        for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet())
                            if (h.getKey() != null && h.getValue() != null && !h.getValue().isEmpty()) out.put(h.getKey(), h.getValue().get(0));
                        String type = c.getContentType();
                        String mime = type == null ? "audio/mp4" : type.split(";")[0].trim();
                        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in == null) in = new ByteArrayInputStream(new byte[0]);
                        if (code >= 300 && code < 400) code = 502;
                        return new WebResourceResponse(mime, null, code, reason, out, in);
                    } catch (Exception e) {
                        return super.shouldInterceptRequest(view, request);
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
`);

// JioSaavn sign-in: opens jiosaavn.com inside the app; the person signs in there (phone number + code),
// taps Done, and AURA reads that sign-in from the app's own cookie store.
fs.writeFileSync(path.join(pkgDir, 'JioLoginPlugin.java'), `package ${cap.appId};

import android.app.Dialog;
import android.graphics.Color;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "JioLogin")
public class JioLoginPlugin extends Plugin {
    private static final String SITE = "https://www.jiosaavn.com";

    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            final boolean[] finished = { false };
            final Dialog d = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar_Fullscreen);
            LinearLayout root = new LinearLayout(getActivity());
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.WHITE);

            LinearLayout bar = new LinearLayout(getActivity());
            bar.setOrientation(LinearLayout.HORIZONTAL);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setBackgroundColor(Color.parseColor("#111514"));
            int pad = (int) (8 * getActivity().getResources().getDisplayMetrics().density);
            bar.setPadding(pad, pad, pad, pad);
            Button cancel = new Button(getActivity());
            cancel.setText("Cancel");
            TextView title = new TextView(getActivity());
            title.setText("Sign in to JioSaavn, then tap Done");
            title.setTextColor(Color.WHITE);
            title.setGravity(Gravity.CENTER);
            Button done = new Button(getActivity());
            done.setText("Done");
            bar.addView(cancel);
            bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            bar.addView(done);

            final WebView wv = new WebView(getActivity());
            WebSettings ws = wv.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(wv, true);
            wv.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest req) {
                    String s = req.getUrl().getScheme();
                    return !("http".equals(s) || "https".equals(s)); // stay on the website; ignore "open in app" links
                }
            });
            wv.loadUrl(SITE + "/");

            done.setOnClickListener(v -> {
                if (finished[0]) return;
                finished[0] = true;
                CookieManager.getInstance().flush();
                String c = CookieManager.getInstance().getCookie(SITE);
                JSObject r = new JSObject();
                r.put("cookie", c == null ? "" : c);
                d.dismiss();
                wv.destroy();
                call.resolve(r);
            });
            cancel.setOnClickListener(v -> d.dismiss());
            d.setOnDismissListener(x -> {
                if (finished[0]) return;
                finished[0] = true;
                wv.destroy();
                call.reject("cancelled");
            });

            root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            root.addView(wv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
            d.setContentView(root);
            d.show();
        });
    }

    // Forget the JioSaavn sign-in kept inside the app.
    @PluginMethod
    public void signOut(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager cm = CookieManager.getInstance();
            String c = cm.getCookie(SITE);
            if (c != null) {
                for (String part : c.split(";")) {
                    String name = part.split("=")[0].trim();
                    if (name.isEmpty()) continue;
                    cm.setCookie(SITE, name + "=; Max-Age=0; Path=/");
                    cm.setCookie(SITE, name + "=; Max-Age=0; Path=/; Domain=.jiosaavn.com");
                }
            }
            cm.flush();
            call.resolve();
        });
    }
}
`);

console.log(`AURA icons installed; ${n} splash image(s) replaced; playback settings applied.`);
