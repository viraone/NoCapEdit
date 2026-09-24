import {
  Inter,
  Montserrat,
  Bangers,
  Playfair_Display,
  Bebas_Neue,
  Courier_Prime,
  Permanent_Marker,
  Space_Grotesk,
} from "next/font/google";
import { registerFontFamilies } from "@/lib/captions/fonts";

// Fonts are downloaded at build time by next/font and self-hosted with the
// static export, so there are no runtime requests to Google.
export const inter = Inter({ subsets: ["latin"], display: "swap" });
export const montserrat = Montserrat({ subsets: ["latin"], display: "swap" });
export const bangers = Bangers({ subsets: ["latin"], weight: "400", display: "swap" });
export const playfair = Playfair_Display({ subsets: ["latin"], display: "swap" });
export const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap" });
export const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], display: "swap" });
export const marker = Permanent_Marker({ subsets: ["latin"], weight: "400", display: "swap" });
export const grotesk = Space_Grotesk({ subsets: ["latin"], display: "swap" });

export const FONT_OBJECTS = { inter, montserrat, bangers, playfair, bebas, courier, marker, grotesk } as const;

registerFontFamilies({
  inter: inter.style.fontFamily,
  montserrat: montserrat.style.fontFamily,
  bangers: bangers.style.fontFamily,
  playfair: playfair.style.fontFamily,
  bebas: bebas.style.fontFamily,
  courier: courier.style.fontFamily,
  marker: marker.style.fontFamily,
  grotesk: grotesk.style.fontFamily,
});

/** Class names that force every font to be included in the CSS and loaded. */
export const ALL_FONT_CLASSES = Object.values(FONT_OBJECTS).map((f) => f.className);
