// This module implements a custom panic handler for Rust applications.
// Its purpose is to capture detailed crash information, format it into a
// Sentry-like JSON structure, and save it to a file. This allows for
// post-mortem analysis of application crashes.

use std::panic;
use serde::Serialize;
use backtrace::Backtrace;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use std::fs::File;
use std::io::Write;

// Represents a single frame in a stack trace, compatible with Sentry's format.
#[derive(Serialize, Debug)]
struct MyFrame {
    filename: Option<String>, // The name of the file in which this frame is located.
    lineno: Option<u32>,     // The line number in the file.
    colno: Option<u32>,      // The column number in the file.
    function: Option<String>,// The name of the function in which this frame is located.
}

// Represents a stack trace, containing a list of frames.
#[derive(Serialize, Debug)]
struct MyStacktrace {
    frames: Vec<MyFrame>, // A list of frames, ordered from outermost to innermost call.
}

// Represents the overall Sentry event structure to be serialized.
#[derive(Serialize, Debug)]
struct SentryEvent {
    event_id: String,             // A unique identifier for this event (UUID v4).
    timestamp: String,            // Timestamp of the event (seconds since UNIX epoch).
    message: Option<String>,      // The panic message.
    level: Option<String>,        // The severity level of the event (e.g., "fatal").
    platform: Option<String>,     // The platform on which the event occurred (e.g., "rust").
    stacktrace: Option<MyStacktrace>, // The stack trace information.
}

/// Custom panic hook that captures panic information and writes it to a JSON file.
/// This function is set as the global panic handler using `std::panic::set_hook`.
fn custom_panic_hook(info: &std::panic::PanicInfo) {
    // Initial feedback to console that our hook is running.
    println!("Custom panic hook triggered!");

    // Generate a unique ID for this crash event.
    let event_id_str = Uuid::new_v4().to_string();
    // Get the current timestamp as seconds since UNIX epoch.
    let timestamp_str = SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_else(|e| {
            // Handle cases where system time might be before UNIX epoch (highly unlikely).
            eprintln!("SystemTime before UNIX EPOCH! {:?}", e);
            std::time::Duration::from_secs(0)
        })
        .as_secs_f64()
        .to_string();

    // Extract the panic payload (the message passed to panic!).
    // Tries to downcast the payload to common string types.
    let payload = info.payload();
    let message_str = if let Some(s) = payload.downcast_ref::<&str>() {
        *s
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.as_str()
    } else {
        "Panic occurred without a string message." // Fallback message.
    };

    // Get the location (file, line, column) of the panic.
    let location_str = if let Some(location) = info.location() {
        format!("{}:{}:{}", location.file(), location.line(), location.column())
    } else {
        "Unknown location".to_string()
    };
    // Print basic panic info to console for immediate visibility.
    println!("Panic message: {}", message_str);
    println!("Location: {}", location_str);

    // Capture the current backtrace.
    let mut frames = Vec::new();
    let bt = Backtrace::new();

    // Process each frame in the backtrace.
    // `backtrace::resolve` is used to get symbol information (function name, file, line)
    // for each instruction pointer in the backtrace.
    for frame_in_loop in bt.frames() {
        backtrace::resolve(frame_in_loop.ip(), |symbol| {
            let name = symbol.name().map(|s| s.to_string());
            let filename = symbol.filename().map(|p| p.to_string_lossy().into_owned());
            let lineno = symbol.lineno();
            let colno = symbol.colno();

            // Create our custom MyFrame struct from the symbol information.
            frames.push(MyFrame {
                filename,
                lineno,
                colno,
                function: name,
            });
        });
    }

    // Sentry expects frames from innermost to outermost.
    // `backtrace` provides them outermost to innermost, so we reverse.
    frames.reverse();

    // Create the stacktrace structure.
    let stacktrace = if !frames.is_empty() {
        Some(MyStacktrace { frames })
    } else {
        None
    };

    // Populate the SentryEvent structure with all gathered information.
    let sentry_event = SentryEvent {
        event_id: event_id_str.clone(), // Use the generated UUID.
        timestamp: timestamp_str,       // Use the generated timestamp.
        message: Some(message_str.to_string()), // The panic message.
        level: Some("fatal".to_string()),       // Panics are typically fatal.
        platform: Some("rust".to_string()),     // Indicate the platform.
        stacktrace,                             // The captured stacktrace.
    };

    // Serialize the SentryEvent to a pretty JSON string.
    let json_payload = match serde_json::to_string_pretty(&sentry_event) {
        Ok(json) => json,
        Err(e) => {
            // If serialization fails, print an error and exit the hook.
            eprintln!("Failed to serialize Sentry event to JSON: {}", e);
            return;
        }
    };

    // Generate a unique filename for the crash report using the event_id.
    let filename = format!("crash_report_{}.json", sentry_event.event_id);

    // Create and write the JSON payload to the file.
    match File::create(&filename) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(json_payload.as_bytes()) {
                eprintln!("Failed to write crash report to file '{}': {}", filename, e);
            } else {
                // Try to print the absolute path of the saved file for user convenience.
                if let Ok(path) = std::fs::canonicalize(&filename) {
                    println!("Crash report saved to {}", path.display());
                } else {
                    println!("Crash report saved to {}", filename); // Fallback to relative path.
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to create crash report file '{}': {}", filename, e);
        }
    }
}

/// A simple function that intentionally panics to test the custom panic handler.
fn cause_panic() {
    panic!("This is a test panic from the application!");
}

/// Main function for the application.
/// Sets up the custom panic hook and then triggers a panic for demonstration.
fn main() {
    // Set our custom_panic_hook as the global panic handler.
    // This ensures that any panic in the application will call our hook.
    panic::set_hook(Box::new(custom_panic_hook));

    println!("Hello, world! Preparing to panic...");

    // Call the function that will cause a panic.
    cause_panic();

    // This line will not be reached because cause_panic() will terminate the program.
    println!("This should not be printed.");
}
