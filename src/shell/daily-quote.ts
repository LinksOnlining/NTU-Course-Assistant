export interface QuoteEntry {
  readonly text: string;
  readonly author: string;
  readonly source: string;
}

/** Public-domain poetry and clearly labeled original short notes. */
export const VERIFIED_QUOTES: readonly QuoteEntry[] = [
  { text: "行到水穷处，坐看云起时。", author: "王维", source: "《终南别业》" },
  { text: "海上生明月，天涯共此时。", author: "张九龄", source: "《望月怀远》" },
  { text: "欲穷千里目，更上一层楼。", author: "王之涣", source: "《登鹳雀楼》" },
  { text: "春风得意马蹄疾，一日看尽长安花。", author: "孟郊", source: "《登科后》" },
  { text: "且将新火试新茶，诗酒趁年华。", author: "苏轼", source: "《望江南·超然台作》" },
  { text: "小舟从此逝，江海寄余生。", author: "苏轼", source: "《临江仙·夜归临皋》" },
  { text: "一蓑烟雨任平生。", author: "苏轼", source: "《定风波·莫听穿林打叶声》" },
  {
    text: "沉舟侧畔千帆过，病树前头万木春。",
    author: "刘禹锡",
    source: "《酬乐天扬州初逢席上见赠》",
  },
  { text: "醉后不知天在水，满船清梦压星河。", author: "唐珙", source: "《题龙阳县青草湖》" },
  { text: "两岸猿声啼不住，轻舟已过万重山。", author: "李白", source: "《早发白帝城》" },
  { text: "今夜月明人尽望，不知秋思落谁家。", author: "王建", source: "《十五夜望月寄杜郎中》" },
  { text: "山光悦鸟性，潭影空人心。", author: "常建", source: "《题破山寺后禅院》" },
  { text: "今天先把眼前的日子过成喜欢的样子。", author: "原创短句", source: "本地寄语" },
  { text: "没关系，慢慢来，风景也在路上。", author: "原创短句", source: "本地寄语" },
  { text: "把平凡的一天，过得有一点闪光。", author: "原创短句", source: "本地寄语" },
  { text: "日子有风有雨，也有刚刚好的晴天。", author: "原创短句", source: "本地寄语" },
  { text: "别急着抵达，路上的自己也值得珍惜。", author: "原创短句", source: "本地寄语" },
  { text: "认真生活的人，自带一束温柔的光。", author: "原创短句", source: "本地寄语" },
  { text: "不必每一步都完美，往前走就有答案。", author: "原创短句", source: "本地寄语" },
  { text: "留一点空白，给日落、晚风和自己。", author: "原创短句", source: "本地寄语" },
  { text: "愿热爱有回声，奔赴的路上有星光。", author: "原创短句", source: "本地寄语" },
  { text: "今日份好心情，正在派送的路上。", author: "原创短句", source: "本地寄语" },
  { text: "哪怕只前进一点点，也算没有辜负今天。", author: "原创短句", source: "本地寄语" },
  { text: "生活不是等风来，而是记得抬头看云。", author: "原创短句", source: "本地寄语" },
];

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function quoteForLocalDate(date: Date): QuoteEntry {
  const key = localDateKey(date);
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return VERIFIED_QUOTES[hash % VERIFIED_QUOTES.length];
}

export function formatHeaderDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

export function millisecondsUntilNextLocalMidnight(date: Date): number {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, nextDay.getTime() - date.getTime());
}
