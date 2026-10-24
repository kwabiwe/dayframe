#include "DayframeThreadSampler.h"

#include <pthread.h>

// iOS user space fits in 36 bits (MACH_VM_MAX_ADDRESS ≈ 0xFC0000000 on arm64); the bits above carry
// pointer-authentication signatures on arm64e system frames. Crash reporters strip with this mask.
static const uint64_t kAddressMask = 0x0000000FFFFFFFFFULL;

uint64_t dayframe_thread_sample_address_mask(void) { return kAddressMask; }

void dayframe_thread_stack_bounds(uint64_t *low, uint64_t *high) {
  pthread_t self = pthread_self();
  uint64_t top = (uint64_t)(uintptr_t)pthread_get_stackaddr_np(self);
  uint64_t size = (uint64_t)pthread_get_stacksize_np(self);
  *high = top;
  *low = size < top ? top - size : 0;
}

static void append(uint64_t address, uint64_t *out, int capacity, int *count) {
  uint64_t stripped = address & kAddressMask;
  if (stripped == 0 || *count >= capacity) return;
  if (*count > 0 && out[*count - 1] == stripped) return;
  out[(*count)++] = stripped;
}

int dayframe_thread_sample(thread_act_t thread, uint64_t stack_low, uint64_t stack_high,
                           uint64_t *out, int capacity, int max_steps) {
#if defined(__arm64__)
  if (thread == MACH_PORT_NULL || out == 0 || capacity <= 0) return 0;
  thread_act_t current = pthread_mach_thread_np(pthread_self());
  if (thread == current) return 0;
  arm_thread_state64_t state;
  mach_msg_type_number_t state_count = ARM_THREAD_STATE64_COUNT;
  uint64_t record[2];
  int count = 0;

  if (thread_suspend(thread) != KERN_SUCCESS) return 0;
  // From here to thread_resume: system calls and stack reads only.
  if (thread_get_state(thread, ARM_THREAD_STATE64, (thread_state_t)&state, &state_count) == KERN_SUCCESS) {
    append(arm_thread_state64_get_pc(state), out, capacity, &count);
    append(arm_thread_state64_get_lr(state), out, capacity, &count);
    uint64_t fp = arm_thread_state64_get_fp(state) & kAddressMask;
    for (int step = 0; step < max_steps && count < capacity; step++) {
      if (fp == 0 || (fp & 0x7) != 0 || fp < stack_low || fp + sizeof(record) > stack_high) break;
      vm_size_t read = 0;
      if (vm_read_overwrite(mach_task_self(), (vm_address_t)fp, sizeof(record),
                            (vm_address_t)record, &read) != KERN_SUCCESS || read != sizeof(record)) break;
      append(record[1], out, capacity, &count);
      uint64_t next = record[0] & kAddressMask;
      if (next <= fp) break;
      fp = next;
    }
  }
  thread_resume(thread);
  return count;
#else
  (void)thread; (void)stack_low; (void)stack_high; (void)out; (void)capacity; (void)max_steps;
  return 0;
#endif
}
