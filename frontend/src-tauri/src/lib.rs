mod backend;

use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// Handle to the uvicorn backend this app spawned (None if the owner already had one on :8000).
struct BackendProc(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Spawn the local FastAPI backend before the window opens; the BootScreen health-gates the reveal.
  let child = backend::spawn_backend();

  tauri::Builder::default()
    .manage(BackendProc(Mutex::new(child)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      grant_microphone(app);
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building Zenith")
    .run(|app_handle, event| {
      // Free the backend (and its VRAM) when the app closes — but only the child WE spawned.
      if let RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<BackendProc>() {
          if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
              let _ = child.kill();
              eprintln!("[zenith] backend terminated on exit.");
            }
          }
        }
      }
    });
}

/// Auto-grant the microphone permission in the WebView so the voice loop's
/// `getUserMedia({audio:true})` resolves. WebView2 denies media permissions by default
/// (no browser-style prompt), which would silently break hold-Space recording. This is
/// always the desired behavior for the owner's personal assistant. No-op off Windows.
#[allow(unused_variables)]
fn grant_microphone(app: &tauri::App) {
  #[cfg(windows)]
  {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
          COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
          COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::PermissionRequestedEventHandler;
        unsafe {
          let core = match webview.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
              eprintln!("[zenith] could not reach CoreWebView2 to grant mic: {e}");
              return;
            }
          };
          let mut token = 0i64;
          let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
            if let Some(args) = args {
              let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
              let _ = args.PermissionKind(&mut kind);
              if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
              }
            }
            Ok(())
          }));
          let _ = core.add_PermissionRequested(&handler, &mut token);
        }
      });
    }
  }
}
