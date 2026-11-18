use serde::{Deserialize, Deserializer, Serialize};

/// Opt-in allocation strategy for the official Windows native player.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowsGpuMemory {
    #[default]
    Performance,
    MemoryUsage,
}

impl WindowsGpuMemory {
    pub const CONFIG_KEY: &str = "windows_gpu_memory";

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Performance => "performance",
            Self::MemoryUsage => "memory_usage",
        }
    }

    /// The containing field can be omitted. An explicit value, including null,
    /// must deserialize as a profile.
    pub fn deserialize_declared<'de, D: Deserializer<'de>>(input: D) -> Result<Option<Self>, D::Error> {
        Self::deserialize(input).map(Some)
    }
}
