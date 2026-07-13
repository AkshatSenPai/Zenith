use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

pub const BACKEND_ADDR: &str = "127.0.0.1:8000";

/// Backend dir: explicit ZENITH_BACKEND_DIR wins; else `<base>/../../backend` (base = CARGO_MANIFEST_DIR).
pub fn resolve_backend_dir_from(env: Option<String>, base: &Path) -> PathBuf {
    match env {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => base.join("..").join("..").join("backend"),
    }
}

/// Python: explicit ZENITH_PYTHON wins; else `<backend_dir>/.venv/Scripts/python.exe`.
pub fn resolve_python_from(env: Option<String>, backend_dir: &Path) -> PathBuf {
    match env {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => backend_dir.join(".venv").join("Scripts").join("python.exe"),
    }
}

pub fn port_in_use(addr: &str) -> bool {
    match addr.parse::<SocketAddr>() {
        Ok(sa) => TcpStream::connect_timeout(&sa, Duration::from_millis(300)).is_ok(),
        Err(_) => false,
    }
}

/// Spawn uvicorn from the venv. Returns None if the port is already served (owner started it) or spawn fails.
pub fn spawn_backend() -> Option<Child> {
    if port_in_use(BACKEND_ADDR) {
        eprintln!("[zenith] backend already on {BACKEND_ADDR}; not spawning.");
        return None;
    }
    let backend_dir = resolve_backend_dir_from(
        std::env::var("ZENITH_BACKEND_DIR").ok(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    );
    let python = resolve_python_from(std::env::var("ZENITH_PYTHON").ok(), &backend_dir);
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"])
        .current_dir(&backend_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[zenith] spawned backend (pid {}) from {:?}", child.id(), python);
            Some(child)
        }
        Err(e) => {
            eprintln!("[zenith] failed to spawn backend ({python:?}): {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_dir_prefers_env() {
        let base = Path::new("C:/app/frontend/src-tauri");
        assert_eq!(
            resolve_backend_dir_from(Some("D:/custom/backend".into()), base),
            PathBuf::from("D:/custom/backend")
        );
    }

    #[test]
    fn backend_dir_default_is_repo_backend() {
        let base = Path::new("C:/app/frontend/src-tauri");
        assert_eq!(
            resolve_backend_dir_from(None, base),
            base.join("..").join("..").join("backend")
        );
    }

    #[test]
    fn python_default_is_venv() {
        let dir = Path::new("C:/app/backend");
        assert_eq!(
            resolve_python_from(None, dir),
            dir.join(".venv").join("Scripts").join("python.exe")
        );
    }

    #[test]
    fn python_prefers_env() {
        let dir = Path::new("C:/app/backend");
        assert_eq!(
            resolve_python_from(Some("py".into()), dir),
            PathBuf::from("py")
        );
    }
}
