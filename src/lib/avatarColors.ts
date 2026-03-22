// WhatsApp-style avatar background colors
const AVATAR_COLORS = [
  '199 89% 48%',   // teal
  '340 82% 52%',   // pink
  '262 52% 47%',   // purple
  '33 100% 50%',   // orange
  '142 71% 45%',   // green
  '207 90% 54%',   // blue
  '0 65% 51%',     // red
  '291 47% 51%',   // violet
  '174 72% 40%',   // cyan
  '47 82% 50%',    // gold
  '14 90% 55%',    // coral
  '231 48% 48%',   // indigo
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getAvatarColor(identifier: string): string {
  const index = hashString(identifier) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}
