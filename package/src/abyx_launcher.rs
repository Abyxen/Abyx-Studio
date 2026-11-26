// Abyx Launcher (Native Windows Binary)
use std::env;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn resolve_frontend_port(requested: u16) -> u16 {
    if is_port_available(requested) {
        return requested;
    }
    for p in 1421..1499 {
        if is_port_available(p) {
            return p;
        }
    }
    requested
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd")
            .args(&["/c", "start", url])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();
    }
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn main() {
    println!("============================================================");
    println!("   ABYX UNIFIED AI STUDIO    |  Launcher");
    println!("============================================================");

    let exe_path = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let root_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));

    let node_path = root_dir.join("app").join("tools").join("node-win").join("node.exe");
    let serve_script = root_dir.join("scripts").join("server").join("serve.cjs");

    if !node_path.exists() {
        eprintln!("[ERROR] Portable Node.js not found at: {}", node_path.display());
        eprintln!("Please run setup.exe to configure portable runtimes.");
        let setup_exe = root_dir.join("setup.exe");
        if setup_exe.exists() {
            let _ = Command::new(setup_exe).current_dir(root_dir).status();
        }
        return;
    }

    if !serve_script.exists() {
        eprintln!("[ERROR] Server entrypoint not found at: {}", serve_script.display());
        return;
    }

    let port = resolve_frontend_port(1420);
    env::set_var("FRONTEND_PORT", port.to_string());

    println!("Starting server on port {}...", port);
    println!("Working directory: {}", root_dir.display());

    let mut server_child: Child = match Command::new(&node_path)
        .arg("--experimental-sqlite")
        .arg(&serve_script)
        .current_dir(root_dir)
        .env("FRONTEND_PORT", port.to_string())
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[ERROR] Failed to start ABYX server: {}", e);
            return;
        }
    };

    let browser_url = format!("http://localhost:{}", port);
    let browser_url_clone = browser_url.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1500));
        println!("Opening web browser at {}...", browser_url_clone);
        open_browser(&browser_url_clone);
    });

    println!("\nABYX Unified AI Studio is active.");
    println!("Press Ctrl+C to stop.\n");

    let _ = server_child.wait();
}
