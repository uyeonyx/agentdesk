// Public entry for the theme system. Importing it touches no DOM; only applyTheme does, when called.
import { BUILTIN_THEMES } from './builtin/index.js';

export { deriveTokens } from './derive.js';
export { applyTheme, isSafeValue, isSafeName } from './apply.js';
export { normalizeTheme, ThemeError, TOKEN_NAMES } from './schema.js';
export { BUILTIN_THEMES, DEFAULT_DARK_ID, DEFAULT_LIGHT_ID } from './builtin/index.js';
export { detectAndImport, MAX_THEME_BYTES } from './import/index.js';

// Built-ins first, then the user's imported themes.
export const findTheme = (id, userThemes = []) => BUILTIN_THEMES.find((t) => t.id === id) ?? userThemes.find((t) => t?.id === id);
