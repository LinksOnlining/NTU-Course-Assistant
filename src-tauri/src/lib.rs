pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}
