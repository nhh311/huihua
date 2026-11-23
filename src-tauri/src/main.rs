// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::{Path, PathBuf};

fn write_line(path: &Path, message: &str) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return false;
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return false;
    };
    writeln!(file, "{message}").is_ok()
}

fn log(message: &str) {
    let mut candidates = Vec::new();
    if let Some(base) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(base).join("绘话").join("logs").join("startup.log"));
    }
    candidates.push(std::env::temp_dir().join("huihua-logs").join("startup.log"));
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("huihua-startup.log"));
    }
    for path in candidates {
        if write_line(&path, message) {
            return;
        }
    }
}

fn main() {
    log("start");
    std::panic::set_hook(Box::new(|info| {
        log(&format!("panic: {info}"));
    }));
    huihua_lib::run();
    log("exit");
}
