const item = (page, text, x, y, width = 24, height = 10) => ({
  page,
  text,
  x,
  y,
  width,
  height,
});

export const periods = [
  { period: 1, startTime: "08:00", endTime: "08:45" },
  { period: 2, startTime: "08:50", endTime: "09:35" },
  { period: 3, startTime: "09:55", endTime: "10:40" },
];

export const xAxisExtraction = {
  fileName: "sanitized-x-axis.pdf",
  pageCount: 1,
  textItemCount: 17,
  pages: [
    {
      page: 1,
      width: 420,
      height: 595,
      items: [
        item(1, "一", 100.2, 550),
        item(1, "三", 200, 550.3),
        item(1, "日", 300.3, 549.8),
        item(1, "结构基础", 100, 460),
        item(1, "(1-2节)1-6周（单）", 100, 445),
        item(1, "校区/场地:JX01-101/教师:教师甲", 100, 430),
        item(1, "/职称:讲师", 100, 415),
        item(1, "跨行课程-", 200, 460),
        item(1, "国际方向", 200, 445),
        item(1, "(3-3节)2-8周(双)", 200, 430),
        item(1, "场地:JX02-202/教师:教师乙/职称:副教授", 200, 415),
        item(1, "实验方法", 300, 460),
        item(1, "(2-2节)7周,15周", 300, 445),
        item(1, "场地:未排地点/教师:教师丙", 300, 430),
        item(1, "/职称:实验师", 300, 415),
        item(1, "无关说明", 20, 100),
        item(1, "页脚", 20, 20),
      ],
    },
  ],
};

export const yAxisExtraction = {
  fileName: "sanitized-y-axis.pdf",
  pageCount: 1,
  textItemCount: 14,
  pages: [
    {
      page: 1,
      width: 840,
      height: 595,
      items: [
        item(1, "一", 74, 100.1),
        item(1, "三", 74.2, 200),
        item(1, "日", 73.8, 300.2),
        item(1, "设计基础", 100, 100),
        item(1, "(1-2节)1-16周", 112, 100),
        item(1, "场地:JX03-303/教师:教师丁", 124, 100),
        item(1, "/职称:讲师", 136, 100),
        item(1, "训练/2/教学班组成:匿名班级", 160, 100, 150),
        item(1, "其他课程：生产实习匿名教师(共1周)/17周/无;", 440, 20, 240),
        item(1, "综合训练B匿名教师(共2周)/1-2周/无;", 440, 200, 210),
        item(1, "劳动教育（二）匿名教师(共17周)/1-17周/无;", 440, 300, 240),
        item(1, "说明一", 500, 100),
        item(1, "说明二", 500, 200),
        item(1, "说明三", 500, 300),
      ],
    },
  ],
};

export const insufficientAxisExtraction = {
  fileName: "sanitized-insufficient-axis.pdf",
  pageCount: 1,
  textItemCount: 6,
  pages: [
    {
      page: 1,
      width: 420,
      height: 595,
      items: [
        item(1, "一", 100, 550),
        item(1, "三", 200, 550),
        item(1, "待确认课程", 100, 460),
        item(1, "(1-2节)1-4周", 100, 445),
        item(1, "场地:JX04-404/教师:教师戊", 100, 430),
        item(1, "/职称:讲师", 100, 415),
      ],
    },
  ],
};

export function headerItems(extraction) {
  return extraction.pages[0].items.filter((entry) => ["一", "三", "日"].includes(entry.text));
}
