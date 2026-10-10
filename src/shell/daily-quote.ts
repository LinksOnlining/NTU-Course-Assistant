export interface QuoteEntry {
  readonly text: string;
  readonly author: string;
  readonly source: string;
}

/** Public-domain poetry and original, unattributed daily notes. */
export const VERIFIED_QUOTES: readonly QuoteEntry[] = [
  { text: "行到水穷处，坐看云起时。", author: "王维", source: "《终南别业》" },
  { text: "海上生明月，天涯共此时。", author: "张九龄", source: "《望月怀远》" },
  { text: "且将新火试新茶，诗酒趁年华。", author: "苏轼", source: "《望江南·超然台作》" },
  { text: "小舟从此逝，江海寄余生。", author: "苏轼", source: "《临江仙·夜归临皋》" },
  { text: "一蓑烟雨任平生。", author: "苏轼", source: "《定风波·莫听穿林打叶声》" },
  { text: "醉后不知天在水，满船清梦压星河。", author: "唐珙", source: "《题龙阳县青草湖》" },
  { text: "山光悦鸟性，潭影空人心。", author: "常建", source: "《题破山寺后禅院》" },
  { text: "明月松间照，清泉石上流。", author: "王维", source: "《山居秋暝》" },
  { text: "晚来天欲雪，能饮一杯无？", author: "白居易", source: "《问刘十九》" },
  { text: "春水碧于天，画船听雨眠。", author: "韦庄", source: "《菩萨蛮·人人尽说江南好》" },
  { text: "疏影横斜水清浅，暗香浮动月黄昏。", author: "林逋", source: "《山园小梅·其一》" },
  { text: "山中何事？松花酿酒，春水煎茶。", author: "张可久", source: "《人月圆·山中书事》" },
  { text: "今天天气不错，适合把心事晾一晾。", author: "原创短句", source: "本地寄语" },
  { text: "先把今天过好，明天再说也不迟。", author: "原创短句", source: "本地寄语" },
  { text: "给生活留个逗号，不必句句都赶着结尾。", author: "原创短句", source: "本地寄语" },
  { text: "普通的一天，也能有小小的高光。", author: "原创短句", source: "本地寄语" },
  { text: "日子不赶路的时候，也有自己的节奏。", author: "原创短句", source: "本地寄语" },
  { text: "去看云吧，待办清单又不会长腿跑掉。", author: "原创短句", source: "本地寄语" },
  { text: "生活未必总有答案，但偶尔有晚霞。", author: "原创短句", source: "本地寄语" },
  { text: "今天也给自己留一小块自由时间。", author: "原创短句", source: "本地寄语" },
  { text: "风吹过来，心里的褶皱就松一点。", author: "原创短句", source: "本地寄语" },
  { text: "不追赶别人的时区，按自己的日出生活。", author: "原创短句", source: "本地寄语" },
  { text: "把烦恼存成草稿，先出去走走。", author: "原创短句", source: "本地寄语" },
  { text: "留点空白，给突然冒出来的好事情。", author: "原创短句", source: "本地寄语" },
  { text: "不是什么都要有意义，吹风也算正经事。", author: "原创短句", source: "本地寄语" },
  { text: "等一场雨停，也是一种安排。", author: "原创短句", source: "本地寄语" },
  { text: "世界很吵，偶尔把音量调低一点。", author: "原创短句", source: "本地寄语" },
  { text: "开一扇窗，把今天的光放进来。", author: "原创短句", source: "本地寄语" },
];

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return [year, month, day].join("-");
}

export function quoteForLocalDate(date: Date): QuoteEntry {
  const key = localDateKey(date);
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return VERIFIED_QUOTES[hash % VERIFIED_QUOTES.length];
}

export function formatHeaderDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return String(date.getMonth() + 1) + "月" + date.getDate() + "日 " + weekday;
}

export function millisecondsUntilNextLocalMidnight(date: Date): number {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, nextDay.getTime() - date.getTime());
}
