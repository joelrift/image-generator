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
  options: TagOption[];
}

/** One selected option key per category (or absent). */
export type SceneTags = Record<string, string | undefined>;

export const TAG_CATEGORIES: readonly TagCategory[] = [
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

/** The phrases for the currently selected options, in category order. */
export function selectedPhrases(tags: SceneTags): string[] {
  const phrases: string[] = [];
  for (const category of TAG_CATEGORIES) {
    const chosen = tags[category.key];
    if (!chosen) continue;
    const option = category.options.find((o) => o.key === chosen);
    if (option) phrases.push(option.phrase);
  }
  return phrases;
}

/** How many chips are selected — for the "N added" hint and the toggle badge. */
export function selectedCount(tags: SceneTags): number {
  return TAG_CATEGORIES.reduce((n, c) => (tags[c.key] ? n + 1 : n), 0);
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
