package com.visstudios.nexo.mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private native bridge. Credential operations are never exposed as Tauri commands. */
object NexoDevice {
    private const val ALIAS = "vis-nexo-session-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @JvmStatic @Synchronized fun call(activity: Activity, operation: String, payload: String): String {
        val prefs = activity.getSharedPreferences("vis-device", Context.MODE_PRIVATE)
        val secret = java.io.File(activity.noBackupFilesDir, "vis-session.enc")
        when (operation) {
            "save" -> {
                require(payload.length <= 32768)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
                val bytes = cipher.doFinal(payload.toByteArray(Charsets.UTF_8))
                val out = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                    .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)).toString()
                val atomic = android.util.AtomicFile(secret)
                val stream = atomic.startWrite()
                try { stream.write(out.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
                catch (error: Exception) { atomic.failWrite(stream); throw error }
                return "{}"
            }
            "load" -> {
                if (!secret.isFile) return "{}"
                try {
                    require(secret.length() <= 65536)
                    val data = JSONObject(secret.readText())
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                        init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(data.getString("iv"), Base64.NO_WRAP)))
                    }
                    return String(cipher.doFinal(Base64.decode(data.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8)
                } catch (_: Exception) { android.util.AtomicFile(secret).delete(); return "{}" }
            }
            "clear" -> { android.util.AtomicFile(secret).delete(); check(!secret.exists()); return "{}" }
            "onboarding" -> { check(prefs.edit().putBoolean("prepared", true).commit()); return "{}" }
            "installer" -> activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
            "settings" -> activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))
            "updates" -> activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/JoseDaniel03/VIS-Nexo/releases")))
            "game-prepare", "game-delete" -> {
                val request = JSONObject(payload)
                val provider = activity.packageManager.resolveContentProvider("com.visstudios.mcrust.worlds", 0)
                // Older engines support internal data only. Never pretend they can use external storage.
                if (provider == null && operation == "game-prepare" && request.optString("storage", "internal") == "internal") return "{}"
                if (provider == null && operation == "game-delete") {
                    try { activity.packageManager.getPackageInfo("com.visstudios.mcrust", 0) }
                    catch (_: android.content.pm.PackageManager.NameNotFoundException) { return "{}" }
                }
                require(provider?.packageName == "com.visstudios.mcrust") { "Update McRust first" }
                val extras = android.os.Bundle().apply {
                    putString("owner", request.getString("owner"))
                    putString("instance", request.getString("instance"))
                    putString("storage", request.optString("storage", "internal"))
                }
                val result = activity.contentResolver.call(Uri.parse("content://com.visstudios.mcrust.worlds"),
                    if (operation == "game-delete") "delete" else "prepare", null, extras)
                check(result?.getBoolean("ok") == true) { "Close McRust and verify storage" }
                return "{}"
            }
            "status" -> return JSONObject().put("prepared", prefs.getBoolean("prepared", false))
                .put("installer_allowed", activity.packageManager.canRequestPackageInstalls())
                .put("remembered", secret.isFile).toString()
            else -> throw IllegalArgumentException("Unsupported device operation")
        }
        return "{}"
    }
}
