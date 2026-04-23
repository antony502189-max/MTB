# Snake Mobile Gestures Design

## Goal

Replace the on-screen directional buttons with swipe controls when the snake game runs on touch/mobile devices.

## Behavior

- Desktop keeps current keyboard support and the existing directional button cluster.
- Touch/mobile devices do not render the directional button cluster.
- Swipe gestures on the snake board map to `up`, `down`, `left`, and `right`.
- Start, pause, continue, reset, and reward buttons remain visible on all devices.
- Touch users see a short hint that the board is controlled with gestures.

## Detection

- Treat a device as touch-capable when it exposes a coarse pointer or `navigator.maxTouchPoints > 0`.
- Re-evaluate capability on the client after mount so the server render stays deterministic.

## Gesture Rules

- Ignore tiny movements below a minimum threshold so taps and jitter do not change direction.
- Resolve the swipe by dominant axis: larger `x` delta means left/right, larger `y` delta means up/down.
- Keep the existing opposite-direction guard so a swipe cannot instantly reverse the snake into itself.

## Scope

- Update `SnakePage.tsx` for touch detection, swipe handling, copy, and conditional control rendering.
- Update `styles.css` for touch-specific board affordances and the helper hint.
- Add targeted tests for swipe mapping and touch capability detection.
