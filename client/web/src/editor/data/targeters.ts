// 目标选择器数据表（§137-142 第四版）。原样移植自旧编辑器，行为不变。
import type { Option } from "./common";

export const targeters: Option[] = [
  ["@s", "@s 自身"],
  ["@t", "@t 指向目标"],
  ["@tg", "@tg 触发目标"],
  ["@np", "@np 最近玩家"],
  ["@ne", "@ne 最近实体"],
  ["@ow", "@ow 主人"],
  ["@p", "@p 玩家查询"],
  ["@e", "@e 实体查询"],
  ["@slo", "@slo 自身坐标"],
  ["@tlo", "@tlo 指向目标坐标"],
  ["@tglo", "@tglo 触发目标坐标"],
  ["@owlo", "@owlo 主人坐标"],
  ["@pl", "@pl 指定坐标"],
  ["@zp", "@zp 指向坐标"],
  ["@bj", "@bj 多边形边界"],
  ["@fw", "@fw 多边形范围"],
  ["@o", "@单坐标+o 圆/扇/环/扇环"],
  ["@el", "@单坐标/单坐标+o 椭圆"],
];

export const targetKinds: Option[] = [
  ["entity", "单实体"],
  ["coordinate", "单坐标"],
  ["range", "范围"],
];

export const entityTargets: Option[] = [
  ["@s", "自身"],
  ["@t", "指向目标"],
  ["@tg", "触发目标"],
  ["@np", "最近玩家"],
  ["@ne", "最近实体"],
  ["@ow", "主人"],
  ["@p", "玩家查询"],
  ["@e", "实体查询"],
];

export const coordinateTargets: Option[] = [
  ["@entitylo", "单实体坐标"],
  ["@pl", "指定坐标"],
  ["@zp", "指向坐标"],
];

export const rangeShapes: Option[] = [
  ["circle", "圆形"],
  ["sector", "扇形"],
  ["ring", "环形"],
  ["fanring", "扇环"],
  ["ellipse", "椭圆"],
  ["polygon", "多边形范围"],
  ["border", "多边形边界"],
];
