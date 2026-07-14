#[cfg(not(target_arch = "wasm32"))]
pub(crate) struct Clock(std::time::Instant);

#[cfg(not(target_arch = "wasm32"))]
impl Clock {
    pub(crate) fn start() -> Self {
        Self(std::time::Instant::now())
    }

    pub(crate) fn elapsed_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
}
// Raw wasm32-unknown-unknown has no native monotonic clock. The embedding
// Worker supplies `{ env: { now_ms: () => performance.now() } }`.
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    #[link_name = "now_ms"]
    fn imported_now_ms() -> f64;
}

#[cfg(target_arch = "wasm32")]
pub(crate) struct Clock(f64);

#[cfg(target_arch = "wasm32")]
impl Clock {
    pub(crate) fn start() -> Self {
        // SAFETY: the embedding contract requires a side-effect-free monotonic
        // clock with the signature declared above.
        Self(unsafe { imported_now_ms() })
    }

    pub(crate) fn elapsed_ms(&self) -> f64 {
        // SAFETY: see `start`; subtraction remains valid across a search call.
        unsafe { imported_now_ms() - self.0 }
    }
}
