//! Keeps the Mac from idle *system* sleep with an IOKit power assertion. The display is allowed to
//! sleep. It cannot prevent sleep from lid closure, low battery or a manual sleep.

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};

type AssertionId = u32;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        level: u32,
        name: CFStringRef,
        id: *mut AssertionId,
    ) -> i32;
    fn IOPMAssertionRelease(id: AssertionId) -> i32;
}

const LEVEL_ON: u32 = 255;

#[derive(Default)]
pub struct KeepAwake {
    id: Option<AssertionId>,
}

impl KeepAwake {
    pub fn is_active(&self) -> bool {
        self.id.is_some()
    }

    pub fn set(&mut self, on: bool) -> Result<(), String> {
        if on == self.id.is_some() {
            return Ok(());
        }
        if on {
            let kind = CFString::new("PreventUserIdleSystemSleep");
            let name = CFString::new("FocusFlow is playing music");
            let mut id: AssertionId = 0;
            let rc = unsafe {
                IOPMAssertionCreateWithName(kind.as_concrete_TypeRef(), LEVEL_ON, name.as_concrete_TypeRef(), &mut id)
            };
            if rc != 0 {
                return Err(format!("could not create power assertion (IOReturn {rc})"));
            }
            self.id = Some(id);
        } else if let Some(id) = self.id.take() {
            unsafe { IOPMAssertionRelease(id) };
        }
        Ok(())
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        let _ = self.set(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release_assertion() {
        let mut k = KeepAwake::default();
        k.set(true).unwrap();
        assert!(k.is_active());
        k.set(true).unwrap();
        k.set(false).unwrap();
        assert!(!k.is_active());
    }
}
