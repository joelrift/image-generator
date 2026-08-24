/**
 * The prompt helper's tag taxonomy and composition, à la GoBANANAS' "BYGG
 * PROMPT" panel — click a chip per category instead of retyping the same
 * descriptors each time.
 *
 * Adapted to this app's actual job, which is restyling a source image while
 * holding its geometry. Two deliberate differences from the GoBANANAS panel:
 *
 * - No "Style" category — that is already the app's Style control
 *   (Photorealistic / Watercolour / Vector); duplicating it here would let the
 *   two disagree.
 * - No "Camera angle" category — the camera is fixed by the source screenshot
 *   and preserved by "Follow the source", so offering facade/bird's-eye/interior
 *   would promise a reframe the tool won't perform. Everything kept here (light,
 *   season, weather, setting, people) is something the model can actually change
 *   without moving the building.
 *
 * Pure and dependency-free so composePrompt is unit-testable without a browser.
 */

export interface TagOption {
  key: string;
  label: string;
  /** The phrase this option contributes to the composed prompt. */
  phrase: string;
}

export interface TagCategory {
  key: string;
  label: string;
  /** When true, several chips can be picked at once (e.g. materials). */
  multi?: boolean;
  options: TagOption[];
}

/**
 * The selection per category: a single option key for single-select groups, or
 * an array of keys for multi-select ones (materials). Absent when nothing is
 * chosen in that group.
 */
export type SceneTags = Record<string, string | string[] | undefined>;

export const TAG_CATEGORIES: readonly TagCategory[] = [
  {
    key: 'materials',
    label: 'Materials',
    multi: true,
    options: [
      { key: 'timber', label: 'Timber', phrase: 'vertical timber cladding' },
      { key: 'charred', label: 'Charred timber', phrase: 'charred shou-sugi-ban timber cladding' },
      { key: 'brick', label: 'Brick', phrase: 'brick masonry facade' },
      { key: 'stone', label: 'Natural stone', phrase: 'natural stone cladding' },
      { key: 'concrete', label: 'Concrete', phrase: 'board-formed concrete' },
      { key: 'render', label: 'White render', phrase: 'smooth white rendered walls' },
      { key: 'zinc', label: 'Standing-seam zinc', phrase: 'standing-seam zinc' },
      { key: 'corten', label: 'Corten steel', phrase: 'weathered Corten steel' },
      { key: 'aluminium', label: 'Dark aluminium', phrase: 'dark aluminium panels' },
      { key: 'glazing', label: 'Large glazing', phrase: 'large glazed openings with slim frames' },
    ],
  },
  {
    key: 'lighting',
    label: 'Lighting',
    options: [
      { key: 'daylight', label: 'Daylight', phrase: 'soft natural daylight' },
      { key: 'golden', label: 'Golden hour', phrase: 'warm golden-hour light' },
      { key: 'overcast', label: 'Overcast', phrase: 'soft even overcast light' },
      { key: 'dramatic', label: 'Dramatic', phrase: 'dramatic directional light, long shadows' },
      { key: 'blue', label: 'Blue hour', phrase: 'blue-hour dusk with warm interior lights on' },
    ],
  },
  {
    key: 'season',
    label: 'Season',
    options: [
      { key: 'spring', label: 'Spring', phrase: 'spring, fresh greenery' },
      { key: 'summer', label: 'Summer', phrase: 'summer, lush vegetation' },
      { key: 'autumn', label: 'Autumn', phrase: 'autumn foliage' },
      { key: 'winter', label: 'Winter', phrase: 'winter, snow on the ground' },
    ],
  },
  {
    key: 'weather',
    label: 'Weather',
    options: [
      { key: 'clear', label: 'Clear', phrase: 'clear sky' },
      { key: 'overcast', label: 'Overcast', phrase: 'overcast sky' },
      { key: 'rain', label: 'Light rain', phrase: 'light rain, wet reflective surfaces' },
      { key: 'mist', label: 'Morning mist', phrase: 'low morning mist' },
      { key: 'snow', label: 'Snow', phrase: 'falling snow' },
    ],
  },
  {
    key: 'setting',
    label: 'Setting',
    options: [
      { key: 'nordic', label: 'Nordic residential', phrase: 'in a Nordic residential setting' },
      { key: 'forest', label: 'Forest / mountain', phrase: 'in a forest and mountain landscape' },
      { key: 'coast', label: 'Coastal', phrase: 'in a coastal landscape' },
      { key: 'urban', label: 'Urban', phrase: 'in an urban street context' },
    ],
  },
  {
    key: 'people',
    label: 'People',
    options: [
      { key: 'few', label: 'A few', phrase: 'a few people in the scene for scale' },
      { key: 'lively', label: 'Lively', phrase: 'lively with people' },
    ],
  },
];

/** The phrases for the currently selected options, in category then option order. */
export function selectedPhrases(tags: SceneTags): string[] {
  const phrases: string[] = [];
  for (const category of TAG_CATEGORIES) {
    const chosen = tags[category.key];
    if (!chosen) continue;
    const chosenKeys = Array.isArray(chosen) ? chosen : [chosen];
    // Iterate options (not chosenKeys) so the order is stable regardless of
    // click order.
    for (const option of category.options) {
      if (chosenKeys.includes(option.key)) phrases.push(option.phrase);
    }
  }
  return phrases;
}

/** How many chips are selected — for the "N selected" hint. Counts each chip. */
export function selectedCount(tags: SceneTags): number {
  return TAG_CATEGORIES.reduce((n, c) => {
    const chosen = tags[c.key];
    if (!chosen) return n;
    return n + (Array.isArray(chosen) ? chosen.length : 1);
  }, 0);
}

/**
 * The full prompt sent to the provider: the free text first, then the selected
 * descriptors. Either part may be empty; the result is trimmed and never has a
 * dangling separator.
 */
export function composePrompt(freeText: string, tags: SceneTags): string {
  const base = freeText.replace(/[,\s]+$/, '').trim();
  const parts = [base, ...selectedPhrases(tags)].filter((p) => p.length > 0);
  return parts.join(', ');
}
