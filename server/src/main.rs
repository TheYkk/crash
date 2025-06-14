use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use serde::Serialize;
use std::fs;
use anyhow::Context;
use breakpad_symbols::{SimpleSymbolSupplier, Symbolizer};
use minidump::Minidump;
use minidump_processor::process_minidump;

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
    // Summary compatible with the frontend
    minidump_summary: Option<serde_json::Value>,
    // Full analysis for future use (not yet consumed by the frontend)
    minidump_analysis: Option<serde_json::Value>,
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

async fn analyze_minidump(id: &str) -> anyhow::Result<(serde_json::Value, serde_json::Value)> {
    let path = format!("{}{}.dmp", MINIDUMP_PREFIX, id);
    let dump = Minidump::read_path(&path)
        .with_context(|| format!("Failed to read minidump {}", path))?;

    // We can pass an empty list of symbol servers. This will prevent any network
    // access, and limit symbolication to local files. For this example, we don't
    // have any local symbol files, so this will be equivalent to no symbolication.
    let provider = Symbolizer::new(SimpleSymbolSupplier::new(Vec::new()));

    let state = process_minidump(&dump, &provider)
        .await
        .with_context(|| format!("Failed to process minidump {}", path))?;

    let mut json_output = Vec::new();
    state.print_json(&mut json_output, false)?;
    let json: serde_json::Value = serde_json::from_slice(&json_output)
        .with_context(|| "Failed to serialize minidump analysis")?;

    // ---------- Build compatibility summary ----------
    let modules_list = json
        .get("modules")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let simplified_modules: Vec<serde_json::Value> = modules_list
        .iter()
        .map(|m| {
            let base_addr = m
                .get("base_addr")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let end_addr = m
                .get("end_addr")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            // size = end - base if both parse OK
            let size = if let (Ok(start), Ok(end)) = (
                u64::from_str_radix(base_addr.trim_start_matches("0x"), 16),
                u64::from_str_radix(end_addr.trim_start_matches("0x"), 16),
            ) {
                end.saturating_sub(start)
            } else {
                0
            };

            serde_json::json!({
                "name": m.get("filename").and_then(|v| v.as_str()).unwrap_or_default(),
                "base_address": base_addr,
                "size": size,
                "version": m.get("version").and_then(|v| v.as_str()).unwrap_or_default(),
            })
        })
        .collect();

    let summary = serde_json::json!({
        "memory_regions": json.get("memory_regions").and_then(|v| v.as_u64()).unwrap_or(0),
        "thread_count": json.get("thread_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "modules": {
            "count": modules_list.len(),
            "list": simplified_modules,
        },
        "os": {
            "cpu": json.pointer("/system_info/cpu_arch").and_then(|v| v.as_str()).unwrap_or(""),
            "family": json.pointer("/system_info/os").and_then(|v| v.as_str()).unwrap_or(""),
        },
        "misc_info": {
            "process_id": json.get("pid").and_then(|v| v.as_u64()).unwrap_or(0),
            "process_create_time": json.pointer("/crash_info/address").and_then(|v| v.as_u64()).unwrap_or(0),
            "processor_current_mhz": serde_json::Value::Null,
            "processor_max_mhz": serde_json::Value::Null,
        }
    });

    Ok((json, summary))
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

    let (minidump_analysis, minidump_summary) = match analyze_minidump(&id).await {
        Ok((analysis, summary)) => (Some(analysis), Some(summary)),
        Err(_) => (None, None),
    };

    let detail = CrashDetail {
        sentry_report: sentry,
        minidump_summary,
        minidump_analysis,
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