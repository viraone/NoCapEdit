import { Circle, Moon, PersonStanding, Rabbit, Snail, SquareSplitHorizontal, Zap } from "lucide-react";
import type { TransitionType } from "@/lib/models/project";

export const SPEEDS: { value: number; label: string; icon: React.ReactNode }[] = [
  { value: 0.5, label: "0.5×", icon: <Snail size={16} /> },
  { value: 1, label: "1×", icon: <PersonStanding size={16} /> },
  { value: 1.5, label: "1.5×", icon: <Rabbit size={16} /> },
  { value: 2, label: "2×", icon: <Zap size={16} /> },
];

export const QUICK_TRANSITIONS: { id: TransitionType; label: string; icon: React.ReactNode }[] = [
  { id: "none", label: "Cut", icon: <SquareSplitHorizontal size={16} /> },
  { id: "fade", label: "Dissolve", icon: <Circle size={16} /> },
  { id: "fadeblack", label: "Fade", icon: <Moon size={16} /> },
];

export const BACKGROUNDS = ["#000000", "#1c1c1e", "#2f3a4a", "#1d2b53", "#4a1942", "#1f3d2b", "#f1e3c8", "#ffffff"];
