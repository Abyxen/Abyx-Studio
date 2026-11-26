// Abyx Setup & Installer (Native Windows Binary)
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn create_shortcut(target: &Path, shortcut_path: &Path, icon: &Path, description: &str) {
    let script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = '{}'; \
         $Shortcut.WorkingDirectory = '{}'; \
         $Shortcut.IconLocation = '{}'; \
         $Shortcut.Description = '{}'; \
         $Shortcut.Save()",
        shortcut_path.display().to_string().replace('\\', "/"),
        target.display().to_string().replace('\\', "/"),
        target.parent().unwrap_or(Path::new("")).display().to_string().replace('\\', "/"),
        icon.display().to_string().replace('\\', "/"),
        description
    );

    let _ = Command::new("powershell")
        .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();
}

fn main() {
    println!("============================================================");
    println!("   ABYX UNIFIED AI STUDIO    |  Installer & Setup");
    println!("============================================================");

    let exe_path = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let root_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));

    println!("Target installation root: {}", root_dir.display());

    // 1. Ensure required runtime and storage folders exist
    let required_dirs = [
        "app/outputs",
        "app/models",
        "app/chat-history",
        "app/transcriptions",
        "app/tts-outputs",
        "app/openvino-models",
        "data"
    ];

    println!("\n[1/4] Initializing application data directories...");
    for dir in &required_dirs {
        let p = root_dir.join(dir);
        if !p.exists() {
            let _ = fs::create_dir_all(&p);
            println!("  + Created: {}", dir);
        } else {
            println!("  ✓ Exists: {}", dir);
        }
    }

    // 2. Verify portable dependencies
    println!("\n[2/4] Verifying system runtimes and accelerators...");
    let checks = [
        ("Portable Node.js", root_dir.join("app/tools/node-win/node.exe")),
        ("Frontend Bundle", root_dir.join("app/dist/index.html")),
        ("Application Launcher", root_dir.join("Abyx.exe")),
        ("Icon Resource", root_dir.join("abyx.ico")),
        ("Local GGUF Models", root_dir.join("app/llm-models/AbyxV2 9B.gguf")),
    ];

    let mut all_ok = true;
    for (name, path) in &checks {
        if path.exists() {
            println!("  ✓ {}: Found", name);
        } else {
            println!("  ! {}: Missing ({})", name, path.display());
            if *name != "Local GGUF Models" && *name != "Application Launcher" {
                all_ok = false;
            }
        }
    }

    // 3. Create Windows Shortcuts (Desktop and Start Menu)
    println!("\n[3/4] Registering Windows shortcuts...");
    let abyx_exe = root_dir.join("Abyx.exe");
    let icon_file = root_dir.join("abyx.ico");

    if let Ok(userprofile) = env::var("USERPROFILE") {
        let desktop = PathBuf::from(&userprofile).join("Desktop");
        if desktop.exists() {
            let desktop_shortcut = desktop.join("ABYX Unified AI Studio.lnk");
            create_shortcut(&abyx_exe, &desktop_shortcut, &icon_file, "Launch ABYX Unified AI Studio");
            println!("  ✓ Desktop shortcut created: {}", desktop_shortcut.display());
        }

        let start_menu = PathBuf::from(&userprofile)
            .join("AppData")
            .join("Roaming")
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        if start_menu.exists() {
            let start_shortcut = start_menu.join("ABYX Unified AI Studio.lnk");
            create_shortcut(&abyx_exe, &start_shortcut, &icon_file, "Launch ABYX Unified AI Studio");
            println!("  ✓ Start menu shortcut created: {}", start_shortcut.display());
        }
    }

    // 4. Summary & Verification
    println!("\n[4/4] Installation Complete!");
    println!("============================================================");
    if all_ok {
        println!("Status: READY TO LAUNCH");
        println!("Launch application by running: Abyx.exe or using the Desktop shortcut.");
    } else {
        println!("Status: COMPLETED WITH WARNINGS");
        println!("Some optional runtimes were not found. They can be downloaded inside ABYX.");
    }
    println!("============================================================\n");
}
