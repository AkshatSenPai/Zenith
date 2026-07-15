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
    // Must be the FIRST plugin registered. A second launch focuses the existing window
    // (via the callback) instead of starting a second app — and therefore a second backend.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
        let _ = w.unminimize();
      }
    }))
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

      #[cfg(desktop)]
      {
        use tauri::Emitter;  // Manager is already imported at the top of this file
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

        // Ctrl+Alt+Z — summon Zenith and toggle voice from any app.
        let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyZ);

        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, _shortcut, event| {
              // Press-to-toggle: act on key-DOWN only; ignore the release.
              if event.state() == ShortcutState::Pressed {
                if let Some(w) = app.get_webview_window("main") {
                  let _ = w.show();
                  let _ = w.unminimize();
                  let _ = w.set_focus();
                }
                let _ = app.emit("voice-hotkey", ());
              }
            })
            .build(),
        )?;

        match app.global_shortcut().register(hotkey) {
          Ok(_) => {}
          Err(e) => eprintln!(
            "[zenith] could not register the Ctrl+Alt+Z global hotkey (already in use?): {e}"
          ),
        }
      }

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
