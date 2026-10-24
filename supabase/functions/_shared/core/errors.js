// A rejected action. `code` is stable and machine-readable; `message` is the Arabic text a player may see.
// Nothing here ever carries a stack trace, SQL text or hidden game data.
export class GameError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'GameError'; this.code = code; this.extra = extra; }
}
export const fail = (code, message, extra) => { throw new GameError(code, message, extra); };

export const MSG = {
  BAD_REQUEST: 'طلب غير صالح.',
  ROOM_NOT_FOUND: 'الغرفة غير موجودة. تحقق من الرمز.',
  ROOM_FULL: 'الغرفة ممتلئة.',
  GAME_STARTED: 'بدأت المباراة في هذه الغرفة بالفعل.',
  ALREADY_IN_GAME: 'أنت داخل مباراة أخرى بالفعل.',
  NOT_MEMBER: 'لست لاعبًا في هذه المباراة.',
  NOT_HOST: 'مضيف الغرفة فقط يمكنه ذلك.',
  NOT_READY: 'اللاعب الآخر لم يكن جاهزًا بعد.',
  NEED_OPPONENT: 'بانتظار انضمام لاعب آخر.',
  WRONG_TURN: 'ليس دورك الآن.',
  WRONG_STATUS: 'هذا الإجراء غير متاح في حالة المباراة الحالية.',
  STALE_STATE: 'حالة اللعبة لديك قديمة. تمت المزامنة، حاول مرة أخرى.',
  TILE_NOT_OWNED: 'القطعة المحددة ليست على رفّك.',
  TAHKIM_PENDING: 'التحكيم قيد الانتظار.',
  NO_TAHKIM: 'لا توجد حركة يمكن تحكيمها الآن.',
  NOT_RESOLVER: 'ليس لك حق الحكم في هذه الحالة.',
  SWAP_NOT_ALLOWED: 'لا يمكن التبديل الآن.',
  NOT_EXPIRED: 'لم ينتهِ الوقت بعد.',
  TIME_UP: 'انتهى وقتك.',
  CONFLICT: 'تعذّر تنفيذ الإجراء بسبب تعارض. حاول مرة أخرى.',
  SERVER_ERROR: 'حدث خطأ في الخادم. حاول مرة أخرى.'
};
