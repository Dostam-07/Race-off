// Race-Off - the music theory tables.
//
// The soundtrack is a 16-step tracker: each of the 16 bars picks a chord from
// CHORDS and a melody line from MELODY. `noteToFreq` converts MIDI note numbers
// to hertz. The engine synth plays these when no decoded MP3 is available.

/** MIDI note -> frequency in hertz (A4 = 440 = note 69). */
export const noteToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Chord voicings, as MIDI note numbers. */
export const CHORDS = {
  F: [53, 57, 60],
  C: [48, 52, 55],
  Dm: [50, 53, 57],
  Bb: [46, 50, 53],
  Am: [45, 48, 52],
  CE: [52, 55, 60],
};

/** The 16-bar chord progression, one entry per bar. */
export const PROGRESSION = [
  'F', 'CE', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C',
  'Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'F', 'F',
];

/** Root note (bass octave) per chord. */
export const ROOTS = { F: 41, CE: 40, C: 36, Dm: 38, Bb: 34, Am: 33 };

/**
 * One melody bar per chord. Each entry is [step, midiNote, lengthInSteps].
 * Sixteenth-note resolution.
 */
export const MELODY = [
  [[0, 69, 2], [2, 72, 2], [4, 77, 3], [7, 76, 1], [8, 77, 2], [10, 72, 2], [12, 69, 4]],
  [[0, 67, 2], [2, 72, 2], [4, 76, 3], [7, 74, 1], [8, 76, 2], [10, 72, 2], [12, 67, 4]],
  [[0, 65, 2], [2, 69, 2], [4, 74, 3], [7, 72, 1], [8, 74, 2], [10, 69, 2], [12, 65, 2], [14, 69, 2]],
  [[0, 70, 3], [3, 74, 3], [6, 77, 2], [8, 79, 4], [12, 77, 2], [14, 74, 2]],
  [[0, 72, 2], [2, 77, 2], [4, 81, 3], [7, 79, 1], [8, 81, 2], [10, 77, 2], [12, 72, 4]],
  [[0, 76, 2], [2, 79, 2], [4, 84, 3], [7, 82, 1], [8, 79, 2], [10, 76, 2], [12, 72, 4]],
  [[0, 74, 2], [2, 77, 2], [4, 82, 4], [8, 81, 2], [10, 79, 2], [12, 77, 2], [14, 74, 2]],
  [[0, 76, 3], [3, 79, 3], [6, 84, 2], [8, 86, 2], [10, 84, 2], [12, 79, 2], [14, 76, 2]],
  [[0, 77, 6], [6, 74, 2], [8, 70, 4], [12, 74, 2], [14, 77, 2]],
  [[0, 79, 6], [6, 76, 2], [8, 72, 4], [12, 76, 2], [14, 79, 2]],
  [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 72, 2], [10, 76, 2], [12, 81, 4]],
  [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 69, 4], [12, 74, 2], [14, 77, 2]],
  [[0, 82, 3], [3, 81, 3], [6, 79, 2], [8, 77, 4], [12, 74, 4]],
  [[0, 84, 3], [3, 82, 3], [6, 79, 2], [8, 76, 4], [12, 79, 4]],
  [[0, 81, 2], [2, 84, 2], [4, 89, 6], [10, 84, 2], [12, 81, 2], [14, 84, 2]],
  [[0, 77, 4], [4, 72, 2], [6, 77, 2], [8, 79, 2], [10, 81, 2], [12, 82, 2], [14, 84, 2]],
];

/** The eight-note star-power arpeggio, played on top while invincible. */
export const STAR_LEAD = [72, 76, 79, 84, 88, 84, 79, 76];

/** Fanfare chords, as [timeOffsetSeconds, chordName, durationSeconds]. */
export const FANFARE = [
  [0, 'F', 0.38], [0.42, 'F', 0.18], [0.63, 'F', 0.18],
  [0.84, 'Bb', 0.6], [1.5, 'C', 0.6], [2.16, 'F', 1.6],
];
