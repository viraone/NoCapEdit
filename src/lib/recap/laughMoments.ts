export interface SoundFrame {
  time: number;
  laugh: number;
  applause: number;
}

export interface LaughMoment {
  start: number;
  end: number;
  score: number;
}

export interface LaughOptions {
  threshold: number;
  maxGap: number;
  minLength: number;
  frameLength: number;
}

export const LAUGH_DEFAULTS: LaughOptions = {
  threshold: 0.3,
  maxGap: 1,
  minLength: 0.8,
  frameLength: 0.5,
};

const LAUGH_CATEGORY_NAMES: readonly string[] = [
  "Laughter",
  "Baby laughter",
  "Giggle",
  "Snicker",
  "Belly laugh",
  "Chuckle, chortle",
];

const APPLAUSE_CATEGORY_NAMES: readonly string[] = ["Applause", "Clapping"];

function matchesCategory(names: readonly string[], categoryName: string): boolean {
  for (const name of names) {
    if (name === categoryName) {
      return true;
    }
  }
  return false;
}

export function toSoundFrame(
  time: number,
  categories: { categoryName: string; score: number }[]
): SoundFrame {
  let laugh = 0;
  let applause = 0;

  for (const category of categories) {
    if (matchesCategory(LAUGH_CATEGORY_NAMES, category.categoryName) && category.score > laugh) {
      laugh = category.score;
    }

    if (matchesCategory(APPLAUSE_CATEGORY_NAMES, category.categoryName) && category.score > applause) {
      applause = category.score;
    }
  }

  return { time, laugh, applause };
}

export function findLaughMoments(
  frames: SoundFrame[],
  options?: Partial<LaughOptions>
): LaughMoment[] {
  const opts: LaughOptions = { ...LAUGH_DEFAULTS, ...options };
  const sorted = [...frames].sort((a, b) => a.time - b.time);

  const groups: LaughMoment[] = [];
  let current: LaughMoment | null = null;

  for (const frame of sorted) {
    const isLaughFrame = frame.laugh >= opts.threshold && frame.laugh >= frame.applause;
    if (!isLaughFrame) {
      continue;
    }

    const frameEnd = frame.time + opts.frameLength;
    const frameScore = frame.laugh * opts.frameLength;

    if (current === null) {
      current = {
        start: frame.time,
        end: frameEnd,
        score: frameScore,
      };
    } else if (frame.time - current.end <= opts.maxGap + 1e-9) {
      current.end = Math.max(current.end, frameEnd);
      current.score += frameScore;
    } else {
      groups.push(current);
      current = {
        start: frame.time,
        end: frameEnd,
        score: frameScore,
      };
    }
  }

  if (current !== null) {
    groups.push(current);
  }

  return groups
    .filter((group) => group.end - group.start >= opts.minLength - 1e-9)
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 1e-12) {
        return b.score - a.score;
      }
      return a.start - b.start;
    });
}

export function pickBiggest(
  moments: LaughMoment[],
  count: number,
  minSpacing: number
): LaughMoment[] {
  if (count <= 0) {
    return [];
  }

  const sorted = [...moments].sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-12) {
      return b.score - a.score;
    }
    return a.start - b.start;
  });

  const kept: LaughMoment[] = [];

  for (const moment of sorted) {
    let farEnough = true;

    for (const keptMoment of kept) {
      if (Math.abs(keptMoment.start - moment.start) < minSpacing) {
        farEnough = false;
        break;
      }
    }

    if (farEnough) {
      kept.push(moment);

      if (kept.length >= count) {
        break;
      }
    }
  }

  return kept.sort((a, b) => a.start - b.start || b.score - a.score);
}

export function playRange(
  moment: LaughMoment,
  duration: number,
  leadIn = 5,
  tail = 1
): { start: number; end: number } {
  return {
    start: Math.max(0, moment.start - leadIn),
    end: Math.min(duration, moment.end + tail),
  };
}
