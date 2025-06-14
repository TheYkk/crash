use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use serde::Serialize;
use std::fs;
use anyhow::Context;

// ----- Data structures returned by the API -----
#[derive(Serialize)]
struct CrashSummary {
    id: String,
    timestamp: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
struct CrashDetail {
    sentry_report: serde_json::Value,
    // Limited subset of minidump information that is inexpensive to compute.
    minidump_summary: Option<serde_json::Value>,
}

const CRASH_REPORT_PREFIX: &str = "crash_report_"; // .json
const MINIDUMP_PREFIX: &str = "crash_dump_"; // .dmp

// Utility to scan workspace directory for crash IDs
fn collect_crash_ids() -> anyhow::Result<Vec<String>> {
    let mut ids = Vec::new();
    for entry in fs::read_dir(".")? {
        let entry = entry?;
        let name = entry.file_name();
        let file_name = name.to_string_lossy();
        if let Some(id) = file_name
            .strip_prefix(CRASH_REPORT_PREFIX)
            .and_then(|s| s.strip_suffix(".json"))
        {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

fn load_sentry_json(id: &str) -> anyhow::Result<serde_json::Value> {
    let path = format!("{}{}.json", CRASH_REPORT_PREFIX, id);
    let data = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read sentry report {}", path))?;
    let json: serde_json::Value = serde_json::from_str(&data)?;
    Ok(json)
}

fn summarize_minidump(id: &str) -> anyhow::Result<serde_json::Value> {
    use minidump::*;

    let path = format!("{}{}.dmp", MINIDUMP_PREFIX, id);
    let dump = Minidump::read_path(&path)
        .with_context(|| format!("Unable to open minidump {}", path))?;

    // We'll gather a handful of useful details that are cheap to compute.
    let mut summary = serde_json::Map::new();

    // Capture OS/CPU enums for later use when decoding the exception.
    let mut os_enum = None;
    let mut cpu_enum = None;

    // System (OS/CPU) ----------------
    let sys_stream = dump.get_stream::<MinidumpSystemInfo>();
    if let Ok(ref sys) = sys_stream {
        os_enum = Some(sys.os);
        cpu_enum = Some(sys.cpu);

        summary.insert("os".into(), serde_json::json!({
            "family": format!("{:?}", sys.os),
            "cpu": format!("{:?}", sys.cpu),
        }));
    }

    // Exception ----------------------
    if let Ok(exc) = dump.get_stream::<MinidumpException>() {
        let reason_str = if let (Some(os), Some(cpu)) = (os_enum, cpu_enum) {
            format!("{:?}", exc.get_crash_reason(os, cpu))
        } else {
            "Unknown".to_string()
        };

        summary.insert(
            "exception".into(),
            serde_json::json!({
                "reason": reason_str,
                "thread_id": exc.thread_id,
            }),
        );
    }

    // Threads ------------------------
    if let Ok(threads) = dump.get_stream::<MinidumpThreadList>() {
        summary.insert("thread_count".into(), serde_json::json!(threads.threads.len()));

        let tops: Vec<_> = threads
            .threads
            .iter()
            .map(|t| {
                if let Ok(ref sys) = sys_stream {
                    let misc_stream = dump.get_stream::<MinidumpMiscInfo>().ok();
                    let ctx_opt = t.context(sys, misc_stream.as_ref());
                    ctx_opt
                        .map(|c| format!("0x{:x}", c.get_instruction_pointer()))
                        .unwrap_or_else(|| "N/A".to_string())
                } else {
                    "N/A".to_string()
                }
            })
            .collect();

        summary.insert("top_frames".into(), serde_json::json!(tops));
    }

    // ---------------- MiscInfo ----------------
    if let Ok(misc) = dump.get_stream::<MinidumpMiscInfo>() {
        // expose fields that are commonly filled (may vary by platform)
        let mut misc_map = serde_json::Map::new();
        let raw = &misc.raw;
        misc_map.insert(
            "process_create_time".into(),
            serde_json::json!(raw.process_create_time()),
        );
        misc_map.insert(
            "process_id".into(),
            serde_json::json!(raw.process_id()),
        );
        misc_map.insert(
            "processor_max_mhz".into(),
            serde_json::json!(raw.processor_max_mhz()),
        );
        misc_map.insert(
            "processor_current_mhz".into(),
            serde_json::json!(raw.processor_current_mhz()),
        );
        summary.insert("misc_info".into(), serde_json::Value::Object(misc_map));
    }

    // ---------------- Module list ----------------
    if let Ok(mods) = dump.get_stream::<MinidumpModuleList>() {
        let mut modules_json = Vec::new();
        for m in mods.iter() {
            modules_json.push(serde_json::json!({
                "name": m.code_file(),
                "version": m.version().unwrap_or_default(),
                "base_address": format!("0x{:x}", m.base_address()),
                "size": m.size(),
            }));
        }
        summary.insert("modules".into(), serde_json::json!({
            "count": mods.iter().count(),
            "list": modules_json,
        }));
    }

    // ---------------- Unloaded modules ----------------
    if let Ok(unloaded) = dump.get_stream::<MinidumpUnloadedModuleList>() {
        summary.insert("unloaded_module_count".into(), serde_json::json!(unloaded.iter().count()));
    }

    // ---------------- Memory info ----------------
    if let Ok(mem_info) = dump.get_stream::<MinidumpMemoryInfoList>() {
        summary.insert(
            "memory_regions".into(),
            serde_json::json!(mem_info.iter().count()),
        );
    } else if let Ok(mem_list) = dump.get_stream::<MinidumpMemoryList>() {
        summary.insert(
            "memory_regions".into(),
            serde_json::json!(mem_list.iter().count()),
        );
    }

    Ok(serde_json::Value::Object(summary))
}

// --------------- HTTP Handlers ----------------

#[get("/crashes")]
async fn get_crashes() -> impl Responder {
    match collect_crash_ids() {
        Ok(ids) => {
            let mut list = Vec::new();
            for id in ids {
                // Attempt to read basic metadata from json
                if let Ok(json) = load_sentry_json(&id) {
                    list.push(CrashSummary {
                        id: id.clone(),
                        timestamp: json
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        message: json
                            .get("message")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    });
                }
            }
            HttpResponse::Ok().json(list)
        }
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[get("/crash/{id}")]
async fn get_crash(id: web::Path<String>) -> impl Responder {
    let id = id.into_inner();
    let sentry = match load_sentry_json(&id) {
        Ok(v) => v,
        Err(e) => return HttpResponse::NotFound().body(e.to_string()),
    };

    let minidump_summary = match summarize_minidump(&id) {
        Ok(v) => Some(v),
        Err(_) => None, // It is OK if minidump is missing or fails to parse
    };

    let detail = CrashDetail {
        sentry_report: sentry,
        minidump_summary,
    };
    HttpResponse::Ok().json(detail)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Find a free port or default 8080
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    println!("Starting crash viewer backend on 0.0.0.0:{}", port);

    HttpServer::new(|| App::new().service(get_crashes).service(get_crash))
        .bind(("0.0.0.0", port.parse::<u16>().unwrap_or(8080)))?
        .run()
        .await
} 