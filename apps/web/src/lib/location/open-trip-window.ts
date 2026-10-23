/**
 * How far back a stay can have begun and still hold a journey in progress (location v4 step 5): bounds
 * the range of idx_stay_segments_user_time that replay cleanup and bootstrap read.
 */
export const OPEN_TRIP_ORIGIN_LOOKBACK_MS = 14 * 24 * 3_600_000;
