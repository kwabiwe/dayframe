#ifndef DayframeThreadSampler_h
#define DayframeThreadSampler_h

#include <mach/mach.h>
#include <stdint.h>

/// Copies a stalled thread's return addresses into `out` (staging QA 24 Oct 2026). Suspends `thread`,
/// reads pc, lr and its frame-pointer chain, and resumes it before returning. Between suspend and
/// resume it only makes system calls and reads stack memory with `vm_read_overwrite`: no allocation,
/// no lock, no Objective-C or Swift runtime, because the suspended thread may hold any of them. The
/// walk stops after `max_steps` frame records, at the first record outside [`stack_low`, `stack_high`),
/// or at any record that does not move towards the stack's top. Returns how many addresses were
/// written; 0 when the thread is the caller's, cannot be suspended or read, or on a non-arm64 build.
int dayframe_thread_sample(thread_act_t thread, uint64_t stack_low, uint64_t stack_high,
                           uint64_t *out, int capacity, int max_steps);

/// The calling thread's stack range, for a later `dayframe_thread_sample` of it from another thread.
void dayframe_thread_stack_bounds(uint64_t *low, uint64_t *high);

/// The pointer-authentication mask applied to every address (the 36 bits iOS user space uses).
uint64_t dayframe_thread_sample_address_mask(void);

#endif
