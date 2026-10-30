//! Native Windows notifications (Sprint 9).
//!
//! Deliberately narrow: only high-signal security events produce a system
//! notification, and the same event can never notify repeatedly. The
//! de-duplication ring remembers the last event keys; an identical key is
//! suppressed while it stays in the ring, so a recurring background loop
//! cannot spam the user.

use std::collections::VecDeque;

use tauri::Runtime;
use tauri_plugin_notification::NotificationExt;

/// Suppressed once this many distinct events were notified afterwards.
const RING_SIZE: usize = 16;

#[derive(Default)]
pub struct NotifyRing {
    recent: VecDeque<String>,
}

impl NotifyRing {
    /// Returns `true` when a notification may be shown for this key.
    pub fn admit(&mut self, key: &str) -> bool {
        if self.recent.iter().any(|entry| entry == key) {
            return false;
        }
        self.recent.push_back(key.to_string());
        while self.recent.len() > RING_SIZE {
            self.recent.pop_front();
        }
        true
    }
}

/// Show a notification. Best effort: a failing notification backend must
/// never break the caller.
pub fn show<R: Runtime>(app: &tauri::AppHandle<R>, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_keys_are_suppressed_while_in_ring() {
        let mut ring = NotifyRing::default();
        assert!(ring.admit("scan-a"));
        assert!(!ring.admit("scan-a"));
        assert!(ring.admit("scan-b"));
        assert!(!ring.admit("scan-a"));
    }

    #[test]
    fn old_keys_are_evicted_after_ring_capacity() {
        let mut ring = NotifyRing::default();
        for index in 0..RING_SIZE {
            assert!(ring.admit(&format!("event-{index}")));
        }
        // One more admission evicts the front key ("event-0").
        assert!(ring.admit("event-16"));
        assert!(!ring.admit("event-16"), "still inside the ring");
        // The evicted key may notify again.
        assert!(ring.admit("event-0"));
    }
}
