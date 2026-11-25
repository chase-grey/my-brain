package com.chasegrey.mybrain;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.WebView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Moves the installed app onto a new build without a reinstall. The github build publishes the web part beside the
 * apk; this downloads it into the app's own files and has the shell serve it in place of the copy inside the apk.
 * The shell remembers that folder itself (capacitor reads it back on start, and drops it when a new apk is installed).
 * A change to the native part cannot arrive that way, so for those this downloads the apk and opens the installer.
 * Everything is fetched from the one release below and nowhere else, whatever the page asks for.
 * What the release says it holds is believed only when it was signed with the key this apk was signed with, and a web
 * part is unpacked only when it is the exact file that signed note names and is not older than the build already here.
 */
@CapacitorPlugin(name = "Update")
public class UpdatePlugin extends Plugin {
    private static final String RELEASE = "https://github.com/chase-grey/my-brain/releases/download/android/";
    private static final String PREFS = "update";
    private static final String UNCONFIRMED = "unconfirmed";
    private static final String BAD = "bad";
    /** The downloaded build that passed the checks below, and the number of the github build it came from. */
    private static final String CHECKED = "checked";
    private static final String BUILD = "build";
    /** A downloaded build that has started this many times without the app saying it came up is given up on. */
    private static final int STARTS_BEFORE_GIVING_UP = 2;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** The folder of the build that was downloaded last and is waiting to be moved onto. */
    private volatile String staged;

    /** Runs before the shell picks the folder to serve, so a build that never comes up is dropped here. */
    @Override
    public void load() {
        SharedPreferences shell = shellPrefs();
        String path = shell.getString(WebView.CAP_SERVER_PATH, "");
        if (path == null || path.isEmpty() || !path.startsWith(webDir().getPath())) return;
        SharedPreferences own = ownPrefs();
        int starts = own.getInt(UNCONFIRMED, 0);
        if (starts >= STARTS_BEFORE_GIVING_UP) {
            shell.edit().putString(WebView.CAP_SERVER_PATH, "").commit();
            own.edit().putString(BAD, new File(path).getName()).putInt(UNCONFIRMED, 0).commit();
        } else {
            own.edit().putInt(UNCONFIRMED, starts + 1).commit();
        }
    }

    /** The native part this apk was built from, a downloaded build that was given up on, and the newest build taken. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("native", nativeStamp());
        result.put("bad", ownPrefs().getString(BAD, ""));
        try {
            result.put("build", newestBuildHere());
        } catch (Exception error) {
            call.reject("could not read the app", error);
            return;
        }
        call.resolve(result);
    }

    /** The app came up, so the build being served is good. Also clears out builds no longer served. */
    @PluginMethod
    public void confirm(PluginCall call) {
        ownPrefs().edit().putInt(UNCONFIRMED, 0).apply();
        String serving = bridge.getServerBasePath();
        String keep = staged;
        worker.execute(() -> {
            File[] builds = webDir().listFiles();
            if (builds == null) return;
            for (File build : builds) {
                String path = build.getPath();
                if (!path.equals(serving) && !path.equals(keep)) delete(build);
            }
        });
        call.resolve();
    }

    /** What the release holds now: `{ web, native, sha256, build }`, as the build wrote and signed it. */
    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            try {
                call.resolve(published());
            } catch (Exception error) {
                call.reject("could not check", error);
            }
        });
    }

    /** Download the web part of a build and unpack it, ready to be moved onto. The next cold start uses it too. */
    @PluginMethod
    public void fetchWeb(PluginCall call) {
        String name = call.getString("name", "");
        if (name == null || !name.matches("[0-9a-f]{4,40}")) {
            call.reject("not a build");
            return;
        }
        worker.execute(() -> {
            File folder = new File(webDir(), name);
            File zip = new File(getContext().getCacheDir(), "web-" + name + ".zip");
            try {
                JSObject release = published();
                long build = release.optLong("build", -1);
                if (!name.equals(release.optString("web"))) throw new IOException("not the published build");
                if (build < newestBuildHere()) throw new IOException("older than the build here");
                // A folder is used again only if it went through these checks; one left by an older apk did not.
                boolean checked = name.equals(ownPrefs().getString(CHECKED, "")) && new File(folder, "index.html").exists();
                if (!checked) {
                    delete(folder);
                    try (OutputStream out = new FileOutputStream(zip)) {
                        download("web-" + name + ".zip", out);
                    }
                    if (!sha256(zip).equalsIgnoreCase(release.optString("sha256"))) throw new IOException("not the file that was published");
                    File unpacking = new File(webDir(), name + ".part");
                    delete(unpacking);
                    unzip(zip, unpacking);
                    if (!new File(unpacking, "index.html").exists()) throw new IOException("no page in the build");
                    if (!unpacking.renameTo(folder)) throw new IOException("could not keep the build");
                }
                staged = folder.getPath();
                shellPrefs().edit().putString(WebView.CAP_SERVER_PATH, staged).commit();
                ownPrefs().edit().putInt(UNCONFIRMED, 0).putString(CHECKED, name).putLong(BUILD, build).commit();
                call.resolve();
            } catch (Exception error) {
                call.reject("could not download", error);
            } finally {
                zip.delete();
            }
        });
    }

    /** Serve the downloaded build from now on. The page reloads itself afterwards and lands on it. */
    @PluginMethod
    public void apply(PluginCall call) {
        String path = staged;
        if (path == null || !new File(path, "index.html").exists()) {
            call.reject("nothing downloaded");
            return;
        }
        bridge.getLocalServer().hostFiles(path);
        call.resolve();
    }

    /** Download the apk and hand it to android's installer, which asks before it installs. */
    @PluginMethod
    public void installApk(PluginCall call) {
        worker.execute(() -> {
            try {
                Context context = getContext();
                File folder = new File(context.getCacheDir(), "update");
                folder.mkdirs();
                File apk = new File(folder, "my-brain.apk");
                try (OutputStream out = new FileOutputStream(apk)) {
                    download("my-brain.apk", out);
                }
                Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(install);
                call.resolve();
            } catch (Exception error) {
                call.reject("could not download", error);
            }
        });
    }

    /** The release's update.json, believed only when its signature was made with the key this apk was signed with. */
    private JSObject published() throws Exception {
        ByteArrayOutputStream text = new ByteArrayOutputStream();
        download("update.json", text);
        ByteArrayOutputStream signature = new ByteArrayOutputStream();
        download("update.json.sig", signature);
        if (!signedLikeThisApk(text.toByteArray(), signature.toByteArray())) throw new IOException("not signed by this app's key");
        return new JSObject(new String(text.toByteArray(), StandardCharsets.UTF_8));
    }

    /** No key is kept in the code: the one to check against is read from the certificate android holds for this apk. */
    private boolean signedLikeThisApk(byte[] text, byte[] signature) throws Exception {
        CertificateFactory certificates = CertificateFactory.getInstance("X.509");
        for (android.content.pm.Signature signer : apkSigners()) {
            PublicKey key = certificates.generateCertificate(new ByteArrayInputStream(signer.toByteArray())).getPublicKey();
            Signature check = Signature.getInstance("EC".equals(key.getAlgorithm()) ? "SHA256withECDSA" : "SHA256withRSA");
            check.initVerify(key);
            check.update(text);
            if (check.verify(signature)) return true;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    @android.annotation.SuppressLint("PackageManagerGetSignatures")
    private android.content.pm.Signature[] apkSigners() throws PackageManager.NameNotFoundException {
        PackageManager packages = getContext().getPackageManager();
        String app = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= 28) {
            return packages.getPackageInfo(app, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
        }
        return packages.getPackageInfo(app, PackageManager.GET_SIGNATURES).signatures;
    }

    /**
     * The number of the newest github build on this phone: the one the apk came from, or a later one whose web part
     * was downloaded. Nothing older is taken, so an old signed build cannot be put back.
     */
    private long newestBuildHere() throws PackageManager.NameNotFoundException {
        Context context = getContext();
        long apk = PackageInfoCompat.getLongVersionCode(context.getPackageManager().getPackageInfo(context.getPackageName(), 0));
        return Math.max(apk, ownPrefs().getLong(BUILD, 0));
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private void download(String file, OutputStream out) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(RELEASE + file).openConnection();
        connection.setUseCaches(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("answered " + connection.getResponseCode());
            try (InputStream in = connection.getInputStream()) {
                copy(in, out);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void unzip(File zip, File into) throws IOException {
        String root = into.getCanonicalPath() + File.separator;
        try (ZipInputStream in = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                File target = new File(into, entry.getName());
                // A zip may name a file outside the folder it is unpacked into; nothing is written there.
                if (!(target.getCanonicalPath() + File.separator).startsWith(root)) throw new IOException("bad path in the build");
                if (entry.isDirectory()) {
                    target.mkdirs();
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(target)) {
                    copy(in, out);
                }
            }
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
    }

    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }

    private File webDir() {
        File folder = new File(getContext().getFilesDir(), "web");
        folder.mkdirs();
        return folder;
    }

    private SharedPreferences shellPrefs() {
        return getContext().getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE);
    }

    private SharedPreferences ownPrefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Written into the manifest by the build: a fingerprint of everything native that went into this apk. */
    private String nativeStamp() {
        try {
            Context context = getContext();
            ApplicationInfo app = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
            String stamp = app.metaData == null ? null : app.metaData.getString("nativeStamp");
            return stamp == null ? "" : stamp;
        } catch (PackageManager.NameNotFoundException error) {
            return "";
        }
    }
}
