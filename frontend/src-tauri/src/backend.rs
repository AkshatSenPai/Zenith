use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

pub const BACKEND_ADDR: &str = "127.0.0.1:8010";

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

/// The resolved backend directory (ZENITH_BACKEND_DIR or `<manifest>/../../backend`).
pub fn backend_dir() -> PathBuf {
    resolve_backend_dir_from(
        std::env::var("ZENITH_BACKEND_DIR").ok(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}

/// The API token the background watcher must send to reach `/proactive` when auth is enforced.
/// Env `ZENITH_API_TOKEN` first, else parsed from `<backend_dir>/.env`. None → send no header
/// (the backend is fail-open when the token is unset, which is the common local case).
pub fn api_token_from(env: Option<String>, backend_dir: &Path) -> Option<String> {
    if let Some(t) = env {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    let text = std::fs::read_to_string(backend_dir.join(".env")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("ZENITH_API_TOKEN=") {
            let v = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

pub fn api_token() -> Option<String> {
    api_token_from(std::env::var("ZENITH_API_TOKEN").ok(), &backend_dir())
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
    let backend_dir = backend_dir();
    let python = resolve_python_from(std::env::var("ZENITH_PYTHON").ok(), &backend_dir);
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8010"])
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

    #[test]
    fn api_token_prefers_env() {
        let dir = Path::new("C:/nonexistent");
        assert_eq!(api_token_from(Some("  tok  ".into()), dir), Some("tok".into()));
    }

    #[test]
    fn api_token_reads_dotenv() {
        let d = std::env::temp_dir().join(format!("ztok{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(".env"), "FOO=1\nZENITH_API_TOKEN=\"abc\"\n").unwrap();
        assert_eq!(api_token_from(None, &d), Some("abc".into()));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn api_token_none_when_absent() {
        assert_eq!(api_token_from(None, Path::new("C:/nonexistent")), None);
    }
}
