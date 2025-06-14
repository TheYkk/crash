// Implements a crash handler using the `crash-handler` crate to generate minidumps.

use crash_handler::{CrashHandler, CrashContext, CrashEvent};
use std::process; // For process::id
// PathBuf might not be needed if we rely on default minidump location for v0.5.1
// use std::path::PathBuf;

// Define a simple struct to implement the CrashEvent trait.
// This struct's methods will be called when a crash occurs.
struct MyCrashEvent;

unsafe impl CrashEvent for MyCrashEvent {
    fn on_crash(&self, crash_context: &CrashContext) -> crash_handler::CrashEventResult {
        // This code runs in a separate, minimal process spawned by crash-handler.
        // It should avoid allocations or complex operations if possible.
        // Using eprintln directly here might be problematic depending on the exact context.
        // Typically, you'd use the provided file descriptor for logging if available.
        // For simplicity, we'll try eprintln.
        eprintln!("Custom CrashEvent: Process {} crashed. Signal: {}", process::id(), crash_context.siginfo.ssi_signo);
        // Note: Printing the full siginfo with {:?} is not possible as it doesn't implement Debug.
        // Printing specific fields like ssi_signo is okay.

        // With crash-handler 0.5.1, minidump generation is handled by the out-of-process
        // helper, typically to a default path like /tmp/crash_reports/<exe_name>/<uuid>.dmp
        // or ~/.config/<exe_name>/crash_reports/<uuid>.dmp on Linux.
        // The main process doesn't directly write the minidump in this model.
        // The `CrashContext` provides details about the crash.
        crash_handler::CrashEventResult::Handled(true) // Indicate the crash has been handled, helper waits for process.
    }
}

/// A simple function that intentionally panics to test the custom panic handler.
fn cause_panic() {
    panic!("This is a test panic from the application!");
}

/// Main function for the application.
fn main() {
    // The `reports_path` logic from the previous attempt (for 0.6.0) is not directly
    // used by `CrashHandler::attach` in version 0.5.1. Minidumps go to a default path.
    // let mut reports_path = PathBuf::from(".");
    // reports_path.push("crash_reports");
    // if let Err(e) = std::fs::create_dir_all(&reports_path) {
    //     eprintln!("Failed to create crash_reports directory... {}", e);
    // }

    // Create an instance of our CrashEvent handler.
    let event_handler = Box::new(MyCrashEvent);

    // Attaching the handler is unsafe because it installs global signal handlers.
    // It returns a Result.
    let handler_result = unsafe { CrashHandler::attach(event_handler) };

    match handler_result {
        Ok(handler) => {
            // The handler must be kept alive for the crash handling to remain active.
            // Leaking it is a common way to ensure it lives for the program's duration.
            // In more complex applications, you might store it in a static variable.
            Box::leak(Box::new(handler));
            println!("Crash handler attached successfully. Minidumps will be written to a default system path.");
            // Default path on Linux is often /tmp/crash_reports/<exe_name>/
            // or ~/.config/<app_name>/crash_reports/
        }
        Err(e) => {
            eprintln!("Failed to attach crash handler: {:?}", e);
            // Depending on the application's requirements, you might want to panic or exit here.
        }
    }

    println!("Hello, world! Preparing to panic...");

    // Call the function that will cause a panic.
    cause_panic();

    // This line will not be reached because cause_panic() will terminate the program.
    println!("This should not be printed.");
}
