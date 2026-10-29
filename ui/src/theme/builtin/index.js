// Built-in theme definitions, in picker order: ours first, then dark/light pairs by family.
import { deskGlassDark, deskGlassLight } from './desk.js';
import { cyberpunk, cyberpunkUmbra, cyberpunkScarlet } from './cyberpunk.js';
import { synthwave84 } from './synthwave.js';
import { dracula } from './dracula.js';
import { nord, nordLight } from './nord.js';
import { catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha } from './catppuccin.js';
import { tokyoNight, tokyoNightStorm, tokyoNightDay } from './tokyonight.js';
import { rosePine, rosePineMoon, rosePineDawn } from './rosepine.js';
import { gruvboxDark, gruvboxLight } from './gruvbox.js';
import { solarizedDark, solarizedLight } from './solarized.js';
import { oneDark, oneLight } from './one.js';
import { githubDark, githubDarkDimmed, githubLight } from './github.js';
import { kanagawaWave, kanagawaLotus } from './kanagawa.js';
import { everforestDark, everforestLight } from './everforest.js';
import { ayuDark, ayuMirage, ayuLight } from './ayu.js';
import { monokai } from './monokai.js';

export const DEFAULT_DARK_ID = 'desk-glass-dark';
export const DEFAULT_LIGHT_ID = 'desk-glass-light';

export const BUILTIN_THEMES = Object.freeze([
  deskGlassDark, deskGlassLight, cyberpunk, cyberpunkUmbra, cyberpunkScarlet, synthwave84,
  dracula, nord, nordLight,
  catppuccinMocha, catppuccinMacchiato, catppuccinFrappe, catppuccinLatte,
  tokyoNight, tokyoNightStorm, tokyoNightDay,
  rosePine, rosePineMoon, rosePineDawn,
  gruvboxDark, gruvboxLight, solarizedDark, solarizedLight, oneDark, oneLight,
  githubDark, githubDarkDimmed, githubLight,
  kanagawaWave, kanagawaLotus, everforestDark, everforestLight,
  ayuDark, ayuMirage, ayuLight, monokai,
]);

export default BUILTIN_THEMES;
