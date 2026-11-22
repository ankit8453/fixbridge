/**
 * Getting a human's attention from a browser tab: a beep, a system
 * notification, a tab-title prefix.
 *
 * Built for the sign-in relay (`lib/otpRelay.ts`): during the pilot a person is
 * waiting on a code that only a team member can send, and the team member is
 * usually in a lecture with the console in a background tab. Every helper here
 * is a no-op wherever the API does not exist (jsdom, older browsers, Chrome on
 * Android, which refuses `new Notification`) — an alert that fails must never
 * take the console down with it.
 */

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  // Both optional: neither exists in jsdom, and Safari < 14.1 only has the prefixed one.
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/**
 * Browsers keep an `AudioContext` suspended until the page has seen a user
 * gesture. Call this from a click/keypress handler; afterwards `playBeep` works
 * even with the tab in the background.
 */
export function unlockAudio(): void {
  const context = getAudioContext();
  if (context && context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
}

/**
 * Two short rising tones, generated rather than loaded — no audio file to ship
 * or cache. Distinct enough from a chat ping to be noticed in a noisy room.
 */
export function playBeep(): void {
  const context = getAudioContext();
  if (!context) return;

  try {
    if (context.state === 'suspended') void context.resume().catch(() => undefined);

    const start = context.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const at = start + index * 0.22;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    });
  } catch {
    // An alert that cannot sound is still shown in the title and the badge.
  }
}

export type AlertPermission = NotificationPermission | 'unsupported';

export function notificationPermission(): AlertPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Must run inside a user gesture — browsers ignore permission prompts otherwise. */
export async function requestNotificationPermission(): Promise<AlertPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Shows a system notification if, and only if, permission is already granted. */
export function showNotification(
  title: string,
  options: { body?: string; tag?: string; onClick?: () => void } = {},
): void {
  if (notificationPermission() !== 'granted') return;
  try {
    const notification = new Notification(title, { body: options.body, tag: options.tag });
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
  } catch {
    // Chrome on Android throws here (it only allows service-worker
    // notifications); the beep and title prefix still fire.
  }
}

const TITLE_PREFIX = /^\(\d+\)\s/;

/** `(3) FixBridge` for a count, the bare title for zero. Idempotent. */
export function setTitleCount(count: number): void {
  if (typeof document === 'undefined') return;
  const base = document.title.replace(TITLE_PREFIX, '');
  document.title = count > 0 ? `(${count}) ${base}` : base;
}
