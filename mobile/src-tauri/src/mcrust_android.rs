//! Android PackageInstaller and exact signed package handoff. No shell commands.
use super::mcrust_catalog;
use jni::{JNIEnv, objects::{JObject, JValue}};
use std::path::Path;
pub fn operate(env:&mut JNIEnv<'_>, activity:&JObject<'_>, payload:&str, apk:&Path, target:&mcrust_catalog::Target)->jni::errors::Result<String> {

                    use sha2::{Digest, Sha256};
                    let package = JObject::from(env.new_string(mcrust_catalog::PACKAGE)?);
                    let pm = env.call_method(activity, "getPackageManager", "()Landroid/content/pm/PackageManager;", &[])?.l()?;
                    let info = env.call_method(&pm, "getPackageInfo", "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;", &[JValue::Object(&package), JValue::Int(0x08000000)]);
                    let installed = match info { Ok(v) => Some(v.l()?), Err(_) => { env.exception_clear()?; None } };
                    let mut ready = false;
                    if let Some(info) = installed {
                        let version = env.call_method(&info, "getLongVersionCode", "()J", &[])?.j()?;
                        let signing = env.get_field(&info, "signingInfo", "Landroid/content/pm/SigningInfo;")?.l()?;
                        let signatures = env.call_method(signing, "getApkContentsSigners", "()[Landroid/content/pm/Signature;", &[])?.l()?;
                        let array = jni::objects::JObjectArray::from(signatures);
                        if env.get_array_length(&array)? != 1 { return Ok("signature_mismatch".into()); }
                        let signature = env.get_object_array_element(&array, 0)?;
                        let bytes = env.call_method(signature, "toByteArray", "()[B", &[])?.l()?;
                        let bytes = env.convert_byte_array(jni::objects::JByteArray::from(bytes))?;
                        if format!("{:x}", Sha256::digest(bytes)) != target.certificate_sha256 { return Ok("signature_mismatch".into()); }
                        ready = version == target.version_code;
                    }
                    if !ready {
                        let allowed = env.call_method(&pm, "canRequestPackageInstalls", "()Z", &[])?.z()?;
                        let own = env.call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])?.l()?;
                        let own_text: String = env.get_string(&jni::objects::JString::from(own))?.into();
                        let intent;
                        if !allowed {
                            let action = JObject::from(env.new_string("android.settings.MANAGE_UNKNOWN_APP_SOURCES")?);
                            intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V", &[JValue::Object(&action)])?;
                            let uri_text = JObject::from(env.new_string(format!("package:{own_text}"))?);
                            let uri = env.call_static_method("android/net/Uri", "parse", "(Ljava/lang/String;)Landroid/net/Uri;", &[JValue::Object(&uri_text)])?.l()?;
                            env.call_method(&intent, "setData", "(Landroid/net/Uri;)Landroid/content/Intent;", &[JValue::Object(&uri)])?;
                        } else {
                            let file_path = JObject::from(env.new_string(apk.to_string_lossy())?);
                            let file = env.new_object("java/io/File", "(Ljava/lang/String;)V", &[JValue::Object(&file_path)])?;
                            let authority = JObject::from(env.new_string(format!("{own_text}.mcrust.files"))?);
                            let uri = env.call_static_method("androidx/core/content/FileProvider", "getUriForFile", "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;", &[JValue::Object(activity), JValue::Object(&authority), JValue::Object(&file)])?.l()?;
                            let action = JObject::from(env.new_string("android.intent.action.VIEW")?);
                            intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V", &[JValue::Object(&action)])?;
                            let mime = JObject::from(env.new_string("application/vnd.android.package-archive")?);
                            env.call_method(&intent, "setDataAndType", "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&uri), JValue::Object(&mime)])?;
                            env.call_method(&intent, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(1)])?;
                        }
                        env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
                        return Ok(if allowed { "install_requested" } else { "permission_required" }.into());
                    }
                    let intent = env.new_object("android/content/Intent", "()V", &[])?;
                    let package = JObject::from(env.new_string(mcrust_catalog::PACKAGE)?);
                    let class = JObject::from(env.new_string("android.app.NativeActivity")?);
                    env.call_method(&intent, "setClassName", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&package), JValue::Object(&class)])?;
                    let key = JObject::from(env.new_string("vis_nexo_launch")?);
                    let value = JObject::from(env.new_string(&payload)?);
                    env.call_method(&intent, "putExtra", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&key), JValue::Object(&value)])?;
                    env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
                    Ok("started".into())
                
}
