import { useColorScheme } from "react-native";

const light = {
  bg: "#EEF0F3",
  surface: "#FFFFFF",
  ink: "#1B2333",
  muted: "#5D6678",
  line: "#D6DAE2",
  ai: "#2C3E7A",
  aiSoft: "#E3E8F6",
  me: "#1B2333",
  meInk: "#F3F5F9",
  fix: "#9A5A00",
  fixSoft: "#FBF0DC",
  ok: "#2F7A4F",
  okSoft: "#E1F1E7",
  rec: "#C2352B",
};

const dark: typeof light = {
  bg: "#12151C",
  surface: "#1B2029",
  ink: "#E7EAF0",
  muted: "#9AA3B5",
  line: "#2C3341",
  ai: "#A9B8EE",
  aiSoft: "#232C45",
  me: "#D9DEEA",
  meInk: "#141821",
  fix: "#F0B85A",
  fixSoft: "#33281A",
  ok: "#79C99A",
  okSoft: "#1A3024",
  rec: "#EF6A5F",
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
