// S2-1：种族立绘展示层——老板终选 wan 档定稿（8 张，入库于 public/assets/portraits/，按种族 id 命名）
// 定位：捏脸预览/名册/成员卡展示层；冒险与战斗移动仍走程序化四向像素 sprite（drawSprite 链路，不切分）
const PORTRAIT_RACES = ['human', 'elf', 'dwarf', 'halfling', 'halforc', 'dragonborn', 'gnome', 'halfelf'];

export function portraitUrl(raceId) {
  return PORTRAIT_RACES.includes(raceId) ? '/assets/portraits/' + raceId + '.png' : null;
}
