// Tile modes: the ONLY thing that differs between the two ways of playing.
// Each profile defines the tile bag [letter, value, count] and the letters a blank may represent.
// Everything else (board, scoring, timer, tahkim, undo, ...) is shared engine code.
// An empty letter is a blank tile. Tiles use the canonical letter ه (never هـ; see FACE in config.js).
// No automatic normalisation (أ→ا, ة→ه, ...): word validity is decided by the human tahkim.

export const EXPANDED_TILES = [
  ['ا',1,8], ['ل',1,8], ['ي',1,6], ['ت',1,4], ['ن',1,4], ['ر',1,4],

  ['و',2,6], ['م',2,4], ['ب',2,4], ['د',2,4], ['ه',2,4],

  ['س',3,4], ['ج',3,2], ['ح',3,2], ['ك',3,2],

  ['خ',4,2], ['ق',4,2], ['ف',4,2],

  ['ث',5,1], ['ذ',5,1], ['ش',5,1], ['ض',5,1],

  ['ط',8,1], ['ظ',8,1], ['ع',8,1],

  ['ص',10,1], ['ز',10,1], ['غ',10,1],

  ['أ',2,4], ['ة',3,3], ['ى',3,2], ['إ',3,2], ['ء',4,2], ['ئ',4,2], ['ؤ',5,1], ['آ',5,1],

  ['',0,2]
];

export const BASIC_TILES = [
  ['ا',1,8], ['ل',1,8], ['ي',1,6], ['ت',1,4], ['ن',1,4], ['ر',1,4],

  ['و',2,6], ['م',2,4], ['ب',2,4], ['د',2,4], ['ه',2,4],

  ['س',3,4], ['ج',3,2], ['ح',3,2], ['ك',3,2],

  ['خ',4,2], ['ق',4,2], ['ف',4,2],

  ['ث',5,1], ['ذ',5,1], ['ش',5,1], ['ض',5,1],

  ['ط',8,1], ['ظ',8,1], ['ع',8,1],

  ['ص',10,1], ['ز',10,1], ['غ',10,1],

  ['',0,2]
];

// Blank-tile picker contents (display order).
export const EXPANDED_ALPHA = 'ءآأؤإئابتثجحخدذرزسشصضطظعغفقكلمنهويةى';
export const BASIC_ALPHA = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';

export const TILE_MODES = {
  expanded: {
    id: 'expanded',
    labelAr: 'الحروف الموسعة',
    labelEn: 'Expanded',
    descAr: 'أ إ آ ء ؤ ئ ة ى\n+ الحروف الأساسية',
    tiles: EXPANDED_TILES,
    alpha: EXPANDED_ALPHA
  },
  basic: {
    id: 'basic',
    labelAr: 'الحروف الأساسية',
    labelEn: 'Basic',
    descAr: 'الحروف الهجائية الأساسية',
    tiles: BASIC_TILES,
    alpha: BASIC_ALPHA
  }
};
