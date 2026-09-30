import type { Metadata } from "next";
import { MobileEditor } from "@/components/mobile/MobileEditor";

export const metadata: Metadata = {
  title: "NoCap Edit · Mobile",
  description: "Pick a video from your phone, get captions in a tap, save it back to Photos. Everything runs on your device.",
};

export default function MobilePage() {
  return <MobileEditor />;
}
