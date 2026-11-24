// ALR Grading desktop app.
// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Documents/ALR Labels, the folder used until the user picks another.
#[tauri::command]
fn default_dir(app: tauri::AppHandle) -> Result<String, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    Ok(docs.join("ALR Labels").to_string_lossy().into_owned())
}

/// Writes one label into `dir`, never overwriting: CARD_10_front.svg, then
/// CARD_10_front (2).svg, and so on. Returns the file name that was used.
#[tauri::command]
fn save_label(dir: String, name: String, contents: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("no save folder chosen".into());
    }
    // Only a plain file name is accepted, never a path.
    let name = Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| n.ends_with(".svg") && !n.starts_with('.'))
        .ok_or("bad file name")?
        .to_string();
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;

    let stem = name.trim_end_matches(".svg");
    let mut candidate = name.clone();
    let mut n = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{stem} ({n}).svg");
        n += 1;
    }
    fs::write(dir.join(&candidate), contents).map_err(|e| format!("could not write file: {e}"))?;
    Ok(candidate)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![default_dir, save_label])
        .run(tauri::generate_context!())
        .expect("error while running ALR Grading");
}

#[cfg(test)]
mod tests {
    use super::save_label;

    #[test]
    fn saves_without_overwriting_and_rejects_paths() {
        let dir = std::env::temp_dir().join(format!("alr-grading-test-{}", std::process::id()));
        let d = dir.to_string_lossy().into_owned();
        assert_eq!(save_label(d.clone(), "CARD_10_front.svg".into(), "<svg/>".into()).unwrap(), "CARD_10_front.svg");
        assert_eq!(save_label(d.clone(), "CARD_10_front.svg".into(), "<svg/>".into()).unwrap(), "CARD_10_front (2).svg");
        assert_eq!(save_label(d.clone(), "CARD_10_front.svg".into(), "<svg/>".into()).unwrap(), "CARD_10_front (3).svg");
        // a path is reduced to its file name, so nothing lands outside the folder
        assert_eq!(save_label(d.clone(), "../../evil.svg".into(), "x".into()).unwrap(), "evil.svg");
        assert!(save_label(d.clone(), "notes.txt".into(), "x".into()).is_err());
        assert!(save_label(String::new(), "a.svg".into(), "x".into()).is_err());
        assert!(dir.join("evil.svg").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
