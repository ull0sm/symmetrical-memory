/**
 * Official WKF Kata List (2026 Ruleset)
 * Katas 1 through 102 as defined by the World Karate Federation.
 * Athlets declare their kata by official number. If the number and name conflict,
 * the number prevails.
 */

export interface OfficialKata {
  number: number;
  name: string;
  style?: string;
}

export const OFFICIAL_WKF_KATAS: OfficialKata[] = [
  { number: 1, name: "Anan", style: "Ryuei-ryu" },
  { number: 2, name: "Anan Dai", style: "Ryuei-ryu" },
  { number: 3, name: "Ananko", style: "Shorin-ryu / Matsubayashi-ryu" },
  { number: 4, name: "Aoyagi", style: "Shito-ryu" },
  { number: 5, name: "Bassai", style: "Shorin-ryu / Tomari-te" },
  { number: 6, name: "Bassai Dai", style: "Shotokan / Shito-ryu" },
  { number: 7, name: "Bassai Sho", style: "Shotokan / Shito-ryu" },
  { number: 8, name: "Chatanyara Kusanku", style: "Shito-ryu" },
  { number: 9, name: "Chibana No Kushanku", style: "Shorin-ryu" },
  { number: 10, name: "Chinte", style: "Shotokan / Shito-ryu" },
  { number: 11, name: "Chinto", style: "Shito-ryu / Wado-ryu" },
  { number: 12, name: "Enpi", style: "Shotokan / Wado-ryu" },
  { number: 13, name: "Fukyugata Ichi", style: "Goju-ryu / Shorin-ryu" },
  { number: 14, name: "Fukyugata Ni", style: "Goju-ryu / Shorin-ryu" },
  { number: 15, name: "Gankaku", style: "Shotokan" },
  { number: 16, name: "Garyu", style: "Kyokushin" },
  { number: 17, name: "Gekisai Dai Ichi", style: "Goju-ryu / Shito-ryu" },
  { number: 18, name: "Gekisai Dai Ni", style: "Goju-ryu / Shito-ryu" },
  { number: 19, name: "Goju Shi Ho", style: "Shotokan / Shito-ryu" },
  { number: 20, name: "Gojushiho Dai", style: "Shotokan / Shito-ryu" },
  { number: 21, name: "Gojushiho Sho", style: "Shotokan / Shito-ryu" },
  { number: 22, name: "Hakutsuru", style: "Matsumura / White Crane" },
  { number: 23, name: "Hangetsu", style: "Shotokan" },
  { number: 24, name: "Haufa", style: "Shito-ryu" },
  { number: 25, name: "Heian Dai Ichi (Shodan)", style: "Shotokan / Shito-ryu" },
  { number: 26, name: "Heian Dai Ni (Nidan)", style: "Shotokan / Shito-ryu" },
  { number: 27, name: "Heian Dai San (Sandan)", style: "Shotokan / Shito-ryu" },
  { number: 28, name: "Heian Dai Yon (Yondan)", style: "Shotokan / Shito-ryu" },
  { number: 29, name: "Heian Dai Go (Godan)", style: "Shotokan / Shito-ryu" },
  { number: 30, name: "Heiku", style: "Ryuei-ryu" },
  { number: 31, name: "Ishimine Bassai", style: "Shorin-ryu" },
  { number: 32, name: "Itosu Rohai Shodan", style: "Shito-ryu" },
  { number: 33, name: "Itosu Rohai Nidan", style: "Shito-ryu" },
  { number: 34, name: "Itosu Rohai Sandan", style: "Shito-ryu" },
  { number: 35, name: "Jiin", style: "Shotokan / Shito-ryu" },
  { number: 36, name: "Jion", style: "Shotokan / Wado-ryu / Shito-ryu" },
  { number: 37, name: "Jitte", style: "Shotokan / Wado-ryu / Shito-ryu" },
  { number: 38, name: "Juroku", style: "Shito-ryu" },
  { number: 39, name: "Kanchin", style: "Uechi-ryu" },
  { number: 40, name: "Kankudai", style: "Shotokan / Shito-ryu" },
  { number: 41, name: "Kankusho", style: "Shotokan / Shito-ryu" },
  { number: 42, name: "Kanshiwa", style: "Uechi-ryu" },
  { number: 43, name: "Kanshu", style: "Uechi-ryu" },
  { number: 44, name: "Kosokun Dai", style: "Shito-ryu" },
  { number: 45, name: "Kosokun Sho", style: "Shito-ryu" },
  { number: 46, name: "Kosokun Shiho", style: "Shito-ryu" },
  { number: 47, name: "Kururunfa", style: "Goju-ryu / Shito-ryu" },
  { number: 48, name: "Kusanku", style: "Wado-ryu" },
  { number: 49, name: "Matsukaze", style: "Shito-ryu" },
  { number: 50, name: "Matsumura Bassai", style: "Shorin-ryu / Shito-ryu" },
  { number: 51, name: "Matsumura Rohai", style: "Shorin-ryu / Shito-ryu" },
  { number: 52, name: "Meikyo", style: "Shotokan" },
  { number: 53, name: "Myojo", style: "Shito-ryu" },
  { number: 54, name: "Naifanchin Shodan", style: "Wado-ryu / Shito-ryu" },
  { number: 55, name: "Naifanchin Nidan", style: "Shito-ryu" },
  { number: 56, name: "Naifanchin Sandan", style: "Shito-ryu" },
  { number: 57, name: "Nanshu", style: "Shito-ryu" },
  { number: 58, name: "Nijushiho", style: "Shotokan / Shito-ryu" },
  { number: 59, name: "Nipaipo", style: "Shito-ryu" },
  { number: 60, name: "Niseishi", style: "Wado-ryu" },
  { number: 61, name: "Ohan", style: "Ryuei-ryu" },
  { number: 62, name: "Ohan Dai", style: "Ryuei-ryu" },
  { number: 63, name: "Oyadomari No Passai", style: "Tomari-te / Shito-ryu" },
  { number: 64, name: "Pachu", style: "Ryuei-ryu" },
  { number: 65, name: "Paiku", style: "Ryuei-ryu" },
  { number: 66, name: "Papuren", style: "Shito-ryu" },
  { number: 67, name: "Passai", style: "Shorin-ryu" },
  { number: 68, name: "Pinan Shodan", style: "Wado-ryu / Shito-ryu" },
  { number: 69, name: "Pinan Nidan", style: "Wado-ryu / Shito-ryu" },
  { number: 70, name: "Pinan Sandan", style: "Wado-ryu / Shito-ryu" },
  { number: 71, name: "Pinan Yondan", style: "Wado-ryu / Shito-ryu" },
  { number: 72, name: "Pinan Godan", style: "Wado-ryu / Shito-ryu" },
  { number: 73, name: "Rohai", style: "Wado-ryu / Shito-ryu" },
  { number: 74, name: "Saifa", style: "Goju-ryu / Shito-ryu" },
  { number: 75, name: "Sanchin", style: "Goju-ryu / Uechi-ryu" },
  { number: 76, name: "Sanseiru", style: "Goju-ryu / Shito-ryu" },
  { number: 77, name: "Seichin", style: "Uechi-ryu" },
  { number: 78, name: "Seienchin", style: "Goju-ryu / Shito-ryu" },
  { number: 79, name: "Seipai", style: "Goju-ryu / Shito-ryu" },
  { number: 80, name: "Seiryu", style: "Shito-ryu" },
  { number: 81, name: "Seishan", style: "Wado-ryu / Goju-ryu" },
  { number: 82, name: "Seisan", style: "Uechi-ryu / Shito-ryu" },
  { number: 83, name: "Shinpa", style: "Shito-ryu" },
  { number: 84, name: "Shinsei", style: "Shito-ryu" },
  { number: 85, name: "Shisochin", style: "Goju-ryu / Shito-ryu" },
  { number: 86, name: "Sochin", style: "Shotokan / Shito-ryu" },
  { number: 87, name: "Suparinpei", style: "Goju-ryu / Shito-ryu" },
  { number: 88, name: "Tekki Shodan", style: "Shotokan" },
  { number: 89, name: "Tekki Nidan", style: "Shotokan" },
  { number: 90, name: "Tekki Sandan", style: "Shotokan" },
  { number: 91, name: "Tensho", style: "Goju-ryu" },
  { number: 92, name: "Tomari Bassai", style: "Tomari-te / Shito-ryu" },
  { number: 93, name: "Unshu", style: "Shorin-ryu" },
  { number: 94, name: "Unsu", style: "Shotokan" },
  { number: 95, name: "Useishi", style: "Wado-ryu" },
  { number: 96, name: "Wankan", style: "Shotokan" },
  { number: 97, name: "Wanshu", style: "Wado-ryu" },
  { number: 98, name: "Chinto (Shotokan Gankaku)", style: "Shotokan" },
  { number: 99, name: "Kururunfa Dai", style: "Goju-ryu" },
  { number: 100, name: "Suparinpei Dai", style: "Goju-ryu" },
  { number: 101, name: "Chatanyara Kusanku Dai", style: "Shito-ryu" },
  { number: 102, name: "Anan Nidan", style: "Ryuei-ryu" },
];

export function getKataByNumber(num: number): OfficialKata | undefined {
  return OFFICIAL_WKF_KATAS.find((k) => k.number === num);
}

export function searchKatas(query: string): OfficialKata[] {
  const q = query.toLowerCase().trim();
  if (!q) return OFFICIAL_WKF_KATAS;
  const num = parseInt(q, 10);
  if (!isNaN(num)) {
    return OFFICIAL_WKF_KATAS.filter((k) => k.number === num || k.name.toLowerCase().includes(q));
  }
  return OFFICIAL_WKF_KATAS.filter((k) => k.name.toLowerCase().includes(q));
}
