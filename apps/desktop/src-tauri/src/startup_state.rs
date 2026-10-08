use std::collections::VecDeque;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct StartupState {
    pub generation: u64,
    pub phase: &'static str,
    pub message: String,
    pub logs: VecDeque<String>,
}

impl Default for StartupState {
    fn default() -> Self {
        Self {
            generation: 0,
            phase: "starting",
            message: "正在启动 PhysicsOS…".into(),
            logs: VecDeque::new(),
        }
    }
}

impl StartupState {
    pub fn begin(&mut self) -> u64 {
        self.generation += 1;
        self.phase = "starting";
        self.message = "正在启动 PhysicsOS…".into();
        self.logs.clear();
        self.generation
    }

    pub fn ready(&mut self, generation: u64) -> bool {
        if generation != self.generation || self.phase != "starting" {
            return false;
        }
        self.phase = "ready";
        self.message = "已就绪，正在打开实验室…".into();
        true
    }

    pub fn fail(&mut self, generation: u64, message: String) -> bool {
        if generation != self.generation {
            return false;
        }
        self.phase = "failed";
        self.message = message;
        true
    }

    pub fn log(&mut self, generation: u64, line: String) {
        if generation != self.generation {
            return;
        }
        if self.logs.len() == 50 {
            self.logs.pop_front();
        }
        self.logs.push_back(line.chars().take(1_000).collect());
    }

    pub fn timeout(&mut self, generation: u64, elapsed: Duration, budget: Duration) -> bool {
        if generation != self.generation || self.phase != "starting" || elapsed < budget {
            return false;
        }
        self.fail(
            generation,
            format!("启动超过 {} 秒。请查看诊断信息后重试。", budget.as_secs()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn timeout_becomes_an_actionable_failure() {
        let mut state = StartupState::default();
        let attempt = state.begin();
        assert!(!state.timeout(attempt, Duration::from_secs(2), Duration::from_secs(3)));
        assert!(state.timeout(attempt, Duration::from_secs(3), Duration::from_secs(3)));
        assert_eq!(state.phase, "failed");
        assert!(state.message.contains("重试"));
    }

    #[test]
    fn retry_ignores_old_readiness_and_failure() {
        let mut state = StartupState::default();
        let old = state.begin();
        let current = state.begin();
        assert!(!state.ready(old));
        assert!(!state.fail(old, "old process exited".into()));
        assert_eq!(state.phase, "starting");
        assert!(state.ready(current));
        assert_eq!(state.phase, "ready");
    }

    #[test]
    fn logs_are_bounded_and_old_process_output_is_ignored() {
        let mut state = StartupState::default();
        let old = state.begin();
        let current = state.begin();
        state.log(old, "old".into());
        for index in 0..100 {
            state.log(current, format!("line {index}"));
        }
        assert_eq!(state.logs.len(), 50);
        assert_eq!(state.logs.front().unwrap(), "line 50");
        state.log(current, "界".repeat(2_000));
        assert!(state.logs.back().unwrap().chars().count() <= 1_000);
    }
}
